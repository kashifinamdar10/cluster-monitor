"""Fetch clusters, warehouses, DLT pipelines, and job runs from Databricks workspaces.

Exposes:
  - Batch helpers (fetch_*) for simple JSON endpoints.
  - stream_compute() for SSE streaming via an asyncio.Queue.
"""
import asyncio
import json
import os
import sys
import threading
import time
from typing import Any

from databricks.sdk import WorkspaceClient
from api.auth_helpers import workspace_client_sp

# Legacy env-var workspace config (still supported as fallback)
WORKSPACE_CONFIGS_JSON = os.getenv("WORKSPACE_CONFIGS", "")

# Clusters whose source should NOT appear in the Interactive Clusters tab.
# PIPELINE clusters belong to DLT and are surfaced via pipelines.list_pipelines().
NON_INTERACTIVE_SOURCES = {"JOB", "PIPELINE"}

# Items batched into each SSE page event sent to the frontend.
# Larger values mean fewer round-trips; smaller values give more granular progress updates.
_PAGE_SIZE_HINT = 50

# Per-workspace fetch failures (cert validation, private-link, auth, ...).
# Recorded instead of being written as fake "Error: ..." resources so a partial
# scrape never looks like real inventory in Lakebase.
_scrape_errors: list[dict] = []
_scrape_errors_lock = threading.Lock()


def reset_scrape_errors() -> None:
    with _scrape_errors_lock:
        _scrape_errors.clear()


def get_scrape_errors() -> list[dict]:
    with _scrape_errors_lock:
        return list(_scrape_errors)


def _record_scrape_error(phase: str, ws_name: str, exc: Exception) -> None:
    message = str(exc)
    with _scrape_errors_lock:
        _scrape_errors.append({"phase": phase, "workspace": ws_name, "message": message})
    print(f"  ! {phase} failed for {ws_name}: {message}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Workspace client factory
# ---------------------------------------------------------------------------

def get_workspace_clients() -> dict[str, WorkspaceClient]:
    """Return a {name: WorkspaceClient} dict for all enabled workspaces.

    Priority:
      1. settings.json workspaces list (enabled entries only)
         - Current workspace: uses default WorkspaceClient() (app SP auth)
         - Other workspaces:  uses account_sp credentials from settings.json
      2. WORKSPACE_CONFIGS env var (legacy)
      3. Default: current workspace only
    """
    # Use the live in-memory settings (backed by Lakebase) rather than re-reading
    # from disk, which would miss credentials and workspace selections saved via the UI.
    from api.settings import get_current_settings
    settings = get_current_settings()
    enabled_ws = [w for w in settings.workspaces if w.enabled]
    timeout_s  = int(getattr(settings, "request_timeout_seconds", 30) or 30)

    if enabled_ws:
        acct_sp  = settings.account_sp
        has_sp   = bool(acct_sp.client_id and acct_sp.client_secret)

        # Resolve the current workspace host using the app's own default client.
        _default = WorkspaceClient()
        current_host = (_default.config.host or "").rstrip("/")

        clients: dict[str, WorkspaceClient] = {}

        for w in enabled_ws:
            ws_host    = w.host.rstrip("/")
            is_current = ws_host == current_host

            if has_sp:
                # Settings SP configured → use it for every workspace (including current).
                # workspace_client_sp() suppresses the app SP env vars so the SDK only
                # sees the settings credentials.
                try:
                    clients[w.name] = workspace_client_sp(
                        w.host, acct_sp.client_id, acct_sp.client_secret,
                        timeout_s=timeout_s,
                    )
                except Exception as exc:
                    print(f"WARNING: Could not build SP client for {w.name} ({w.host}): {exc}",
                          file=sys.stderr)
            elif is_current:
                # No settings SP — fall back to app SP for current workspace only.
                clients[w.name] = _default
            # else: non-current workspace with no credentials — skip

        if clients:
            return clients
        # Fallthrough if all workspaces were skipped
        ws_name = current_host.replace("https://", "").split(".")[0]
        return {ws_name: _default}

    # 2. Legacy WORKSPACE_CONFIGS env var
    if WORKSPACE_CONFIGS_JSON:
        clients = {}
        for cfg in json.loads(WORKSPACE_CONFIGS_JSON):
            clients[cfg["name"]] = WorkspaceClient(
                host=cfg["host"],
                token=cfg.get("token"),
                client_id=cfg.get("client_id"),
                client_secret=cfg.get("client_secret"),
            )
        return clients

    # 3. Default: current workspace only
    w = WorkspaceClient()
    ws_name = (w.config.host or "").replace("https://", "").split(".")[0]
    return {ws_name: w}


# ---------------------------------------------------------------------------
# Tag helpers
# ---------------------------------------------------------------------------

def parse_tags(custom_tags: Any) -> dict[str, str]:
    if not custom_tags:
        return {}
    if isinstance(custom_tags, dict):
        return dict(custom_tags)
    try:
        return {t.key: t.value for t in custom_tags}
    except AttributeError:
        try:
            return {t["key"]: t["value"] for t in custom_tags}
        except (TypeError, KeyError):
            return {}


# ---------------------------------------------------------------------------
# Per-item builders
# ---------------------------------------------------------------------------

def _build_cluster(c: Any, ws_name: str) -> dict:
    tags = parse_tags(c.custom_tags)
    source = str(c.cluster_source.value) if c.cluster_source else "UNKNOWN"
    # Termination reason: code is the short enum key; type classifies the error category
    tr = c.termination_reason
    termination_code = str(tr.code.value) if (tr and tr.code) else ""
    termination_type = str(tr.type.value) if (tr and tr.type) else ""
    return {
        "workspace": ws_name,
        "name": c.cluster_name or "Unnamed",
        "id": c.cluster_id,
        "state": str(c.state.value) if c.state else "UNKNOWN",
        "state_message": (c.state_message or "").strip(),
        "termination_code": termination_code,
        "termination_type": termination_type,
        "creator": c.creator_user_name or "N/A",
        "spark_version": c.spark_version or "N/A",
        "node_type": c.node_type_id or "N/A",
        "num_workers": c.num_workers if c.num_workers is not None else "Autoscale",
        "cluster_source": source,
        "is_job_cluster": source == "JOB",
        "is_pipeline_cluster": source == "PIPELINE",
        "tags": tags,
        "tag_str": ", ".join(f"{k}={v}" for k, v in tags.items()) if tags else "",
    }


def _build_warehouse(wh: Any, ws_name: str) -> dict:
    tags = parse_tags(wh.tags.custom_tags if wh.tags else None)
    # On Azure every warehouse returns warehouse_type=PRO regardless of tier.
    # enable_serverless_compute is the only reliable way to distinguish.
    is_serverless = bool(wh.enable_serverless_compute)
    raw_type = str(wh.warehouse_type.value) if wh.warehouse_type else "UNKNOWN"
    if is_serverless:
        display_type = "Serverless"
    elif raw_type == "PRO":
        display_type = "Pro"
    elif raw_type == "CLASSIC":
        display_type = "Classic"
    else:
        display_type = raw_type.title()
    return {
        "workspace": ws_name,
        "name": wh.name or "Unnamed",
        "id": wh.id,
        "state": str(wh.state.value) if wh.state else "UNKNOWN",
        "creator": wh.creator_name or "N/A",
        "size": wh.cluster_size or "N/A",
        "type": display_type,
        "auto_stop_mins": wh.auto_stop_mins if wh.auto_stop_mins else "N/A",
        "min_num_clusters": wh.min_num_clusters if wh.min_num_clusters is not None else 1,
        "max_num_clusters": wh.max_num_clusters if wh.max_num_clusters is not None else 1,
        "num_clusters": wh.num_clusters if wh.num_clusters is not None else 0,
        "num_active_sessions": wh.num_active_sessions if wh.num_active_sessions is not None else 0,
        "tags": tags,
        "tag_str": ", ".join(f"{k}={v}" for k, v in tags.items()) if tags else "",
    }


def _build_pipeline(p: Any, ws_name: str) -> dict:
    """Build a dict from a PipelineStateInfo object."""
    latest_updates: list[dict] = []
    for u in (p.latest_updates or [])[:3]:
        latest_updates.append({
            "update_id": u.update_id or "",
            "state": str(u.state.value) if u.state else "UNKNOWN",
        })
    return {
        "workspace": ws_name,
        "name": p.name or "Unnamed",
        "id": p.pipeline_id or "",
        "state": str(p.state.value) if p.state else "UNKNOWN",
        "creator": p.creator_user_name or p.run_as_user_name or "N/A",
        "cluster_id": p.cluster_id or "",
        "latest_updates": latest_updates,
    }


def _build_job_run(r: Any, ws_name: str) -> dict:
    """Build a dict from a BaseRun object."""
    life_cycle = (
        str(r.state.life_cycle_state.value)
        if r.state and r.state.life_cycle_state
        else "UNKNOWN"
    )
    result_state = (
        str(r.state.result_state.value)
        if r.state and r.state.result_state
        else ""
    )
    start_ms = r.start_time or 0
    now_ms = int(time.time() * 1000)
    duration_ms = (now_ms - start_ms) if start_ms else 0

    return {
        "workspace": ws_name,
        "run_id": str(r.run_id or ""),
        "job_id": str(r.job_id or ""),
        "run_name": r.run_name or f"Run {r.run_id}",
        "state": life_cycle,
        "result_state": result_state,
        "start_time_ms": start_ms,
        "duration_ms": duration_ms,
        "trigger": str(r.trigger.value) if r.trigger else "MANUAL",
        "run_type": str(r.run_type.value) if r.run_type else "JOB_RUN",
    }


# ---------------------------------------------------------------------------
# Batch helpers (used by simple JSON endpoints)
# ---------------------------------------------------------------------------

def fetch_single_cluster(cluster_id: str, workspace_name: str | None = None) -> dict | None:
    """Fetch a single cluster by ID, optionally restricted to one workspace."""
    clients = get_workspace_clients()
    if workspace_name:
        clients = {workspace_name: clients[workspace_name]} if workspace_name in clients else {}
    for ws_name, client in clients.items():
        try:
            c = client.clusters.get(cluster_id=cluster_id)
            if c:
                return _build_cluster(c, ws_name)
        except Exception:
            continue
    return None


def fetch_clusters() -> list[dict]:
    rows: list[dict] = []
    for ws_name, client in get_workspace_clients().items():
        try:
            for c in client.clusters.list():
                rows.append(_build_cluster(c, ws_name))
        except Exception as e:
            _record_scrape_error("clusters", ws_name, e)
    return rows


def fetch_warehouses() -> list[dict]:
    rows: list[dict] = []
    for ws_name, client in get_workspace_clients().items():
        try:
            for wh in client.warehouses.list():
                rows.append(_build_warehouse(wh, ws_name))
        except Exception as e:
            _record_scrape_error("warehouses", ws_name, e)
    return rows


def fetch_pipelines() -> list[dict]:
    rows: list[dict] = []
    for ws_name, client in get_workspace_clients().items():
        try:
            for p in client.pipelines.list_pipelines():
                rows.append(_build_pipeline(p, ws_name))
        except Exception as e:
            _record_scrape_error("pipelines", ws_name, e)
    return rows


def fetch_job_runs() -> list[dict]:
    """Return active Lakeflow Job runs (PENDING / RUNNING / TERMINATING)."""
    rows: list[dict] = []
    for ws_name, client in get_workspace_clients().items():
        try:
            for r in client.jobs.list_runs(active_only=True, expand_tasks=False):
                rows.append(_build_job_run(r, ws_name))
        except Exception as e:
            _record_scrape_error("job_runs", ws_name, e)
    return rows


# ---------------------------------------------------------------------------
# Streaming helper — fills an asyncio Queue from a background thread
# ---------------------------------------------------------------------------

def _stream_phase(
    phase: str,
    items_iter: Any,
    builder: Any,
    ws_name: str,
    put: Any,
) -> int:
    """Iterate `items_iter`, call `builder` per item, flush pages, return total."""
    page_buf: list[dict] = []
    count_so_far = 0
    page_num = 0

    for raw in items_iter:
        page_buf.append(builder(raw, ws_name))

        if len(page_buf) == _PAGE_SIZE_HINT:
            page_num += 1
            count_so_far += len(page_buf)
            put({
                "type": f"{phase}_page",
                "workspace": ws_name,
                "page": page_num,
                "count_so_far": count_so_far,
                "items": page_buf,
            })
            page_buf = []

    if page_buf:
        page_num += 1
        count_so_far += len(page_buf)
        put({
            "type": f"{phase}_page",
            "workspace": ws_name,
            "page": page_num,
            "count_so_far": count_so_far,
            "items": page_buf,
        })

    put({"type": f"{phase}_done", "workspace": ws_name, "total": count_so_far})
    return count_so_far


ALL_PHASES = ("clusters", "warehouses", "pipelines", "job_runs")


def stream_compute(
    q: "asyncio.Queue[dict | None]",
    loop: asyncio.AbstractEventLoop,
    *,
    phases: tuple[str, ...] = ALL_PHASES,
    state_filter: list[str] | None = None,
    workspace_filter: str | None = None,
) -> None:
    """Run SDK calls in a daemon thread, posting SSE event dicts into `q`.

    Parameters
    ----------
    phases:
        Which resource types to fetch.  Defaults to all four.
    state_filter:
        Upper-case state strings (e.g. ["RUNNING"]).  Applied server-side for
        clusters (via ListClustersFilterBy); client-side for other types.
    workspace_filter:
        If set, only query the workspace whose name matches this value.

    Event types emitted (subset depending on phases):
      progress          — human-readable status string
      clusters_page     — {workspace, page, count_so_far, items}
      clusters_done     — {workspace, total}
      warehouses_page / warehouses_done
      pipelines_page  / pipelines_done
      job_runs_page   / job_runs_done
      error             — {phase, workspace, message}
      done              — totals dict
      None (sentinel)   — stream finished
    """

    def put(msg: dict) -> None:
        loop.call_soon_threadsafe(q.put_nowait, msg)

    def _cluster_iter(client: WorkspaceClient, _ws: str):
        if state_filter:
            try:
                from databricks.sdk.service.compute import ListClustersFilterBy, State
                sdk_states = [State[s] for s in state_filter if s in State.__members__]
                fb = ListClustersFilterBy(cluster_states=sdk_states or None)
                return client.clusters.list(filter_by=fb, page_size=100)
            except Exception:
                pass  # fall back to unfiltered
        return client.clusters.list(page_size=100)

    def _state_matches(item: dict) -> bool:
        """Client-side state check for resource types that lack server-side filtering."""
        if not state_filter:
            return True
        return item.get("state", "").upper() in state_filter

    def _warehouse_iter(client: WorkspaceClient, ws: str):
        for wh in client.warehouses.list():
            row = _build_warehouse(wh, ws)
            if _state_matches(row):
                yield row  # already built — wrap in a pass-through builder below

    def _pipeline_iter(client: WorkspaceClient, ws: str):
        for p in client.pipelines.list_pipelines():
            row = _build_pipeline(p, ws)
            if _state_matches(row):
                yield row

    def _job_run_iter(client: WorkspaceClient, ws: str):
        for r in client.jobs.list_runs(active_only=True, expand_tasks=False):
            row = _build_job_run(r, ws)
            if _state_matches(row):
                yield row

    # For pre-built iterators we use an identity builder
    def _identity(item: Any, _ws: str) -> dict:
        return item

    def run() -> None:
        all_clients = get_workspace_clients()
        # Optionally restrict to a single workspace
        if workspace_filter:
            clients = {k: v for k, v in all_clients.items() if k == workspace_filter}
            if not clients:
                put({"type": "error", "phase": "all", "workspace": workspace_filter,
                     "message": f"Workspace '{workspace_filter}' not found in configured clients"})
                put({"type": "done", **{f"total_{p}": 0 for p in ALL_PHASES}})
                loop.call_soon_threadsafe(q.put_nowait, None)
                return
        else:
            clients = all_clients

        totals: dict[str, int] = {p: 0 for p in ALL_PHASES}
        totals_lock = threading.Lock()
        ws_list = list(clients.items())
        num_ws = len(ws_list)

        phase_config = {
            "clusters":   (_cluster_iter,   _build_cluster),
            "warehouses": (_warehouse_iter,  _identity),
            "pipelines":  (_pipeline_iter,   _identity),
            "job_runs":   (_job_run_iter,    _identity),
        }

        # Run all requested phases in parallel — each phase gets its own thread
        # per workspace so warehouses / pipelines don't wait for the cluster page.
        pending = threading.Barrier(
            sum(1 for p in phases if p in phase_config) * num_ws + 1
        )

        def run_phase(phase: str, ws_name: str, client: WorkspaceClient, idx: int) -> None:
            iter_fn, builder = phase_config[phase]
            filter_desc = f" (state={','.join(state_filter)})" if state_filter else ""
            put({"type": "progress",
                 "message": f"{phase.replace('_', ' ').title()}{filter_desc} — [{idx}/{num_ws}] {ws_name}…"})
            try:
                n = _stream_phase(phase, iter_fn(client, ws_name), builder, ws_name, put)
                with totals_lock:
                    totals[phase] += n
            except Exception as exc:
                put({"type": "error", "phase": phase, "workspace": ws_name, "message": str(exc)})
            finally:
                pending.wait()

        for phase in phases:
            if phase not in phase_config:
                continue
            for idx, (ws_name, client) in enumerate(ws_list, 1):
                t = threading.Thread(
                    target=run_phase,
                    args=(phase, ws_name, client, idx),
                    daemon=True,
                )
                t.start()

        # Wait for all phase threads to finish, then emit the summary
        pending.wait()
        put({
            "type": "done",
            **{f"total_{p}": totals[p] for p in ALL_PHASES},
        })
        loop.call_soon_threadsafe(q.put_nowait, None)

    threading.Thread(target=run, daemon=True).start()
