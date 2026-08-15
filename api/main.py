"""FastAPI backend — serves compute data API and the React static build."""
import concurrent.futures
import json
import os
import sys
from datetime import datetime
from typing import Any, Union

from fastapi import FastAPI, HTTPException, Query
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Ensure project root is importable (backend.py lives at root)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from backend import LakebaseBackend, JsonFileBackend  # noqa: E402
import api.settings as settings_module  # noqa: E402
from api.settings import (  # noqa: E402
    AppSettings, AccountSpSettings, WorkspaceConfig,
    load_settings, save_settings,
    get_current_settings, set_current_settings,
    test_lakebase, test_json_path,
)

app = FastAPI(title="Cluster Monitor API", docs_url="/api/docs")

# Allow localhost dev frontend to talk to the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["GET", "PUT", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Backend initialisation — picks whichever storage is configured
# ---------------------------------------------------------------------------

def _make_backend(settings: AppSettings) -> Union[LakebaseBackend, JsonFileBackend]:
    """Construct and initialise the best available history backend."""
    if settings.lakebase.endpoint:
        b: Union[LakebaseBackend, JsonFileBackend] = LakebaseBackend()
    elif settings.json_storage.enabled and settings.json_storage.path:
        b = JsonFileBackend(settings.json_storage.path)
    else:
        # No backend configured — return an uninitialised Lakebase stub so
        # is_available stays False and all history calls return empty lists.
        return LakebaseBackend()
    try:
        b.initialize()
    except Exception as exc:
        print(f"History backend init failed: {exc}")
    return b


_current_settings = load_settings()
set_current_settings(_current_settings)
history_backend: Union[LakebaseBackend, JsonFileBackend] = _make_backend(_current_settings)

# After the backend is ready, try to load settings from Lakebase so that
# credentials configured via the UI survive deploys without a writable filesystem.
if isinstance(history_backend, LakebaseBackend) and history_backend.is_available:
    _lb_settings = history_backend.load_app_settings()
    if _lb_settings:
        try:
            _current_settings = AppSettings.from_dict(_lb_settings)
            set_current_settings(_current_settings)
            print("Settings loaded from Lakebase.")
        except Exception as _e:
            print(f"WARNING: Failed to parse Lakebase settings, using defaults: {_e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(obj: Any) -> Any:
    """Recursively make an object JSON-safe."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialize(i) for i in obj]
    return obj


# --- API routes ---
# Compute tables are served from Lakebase snapshots written by the classic
# scrape job. The App does NOT fan out WorkspaceClient calls to spoke workspaces
# (that path fails under Private Link / Apps egress — "Cert validation failed").

@app.get("/api/clusters")
def get_clusters():
    """Read-only: latest cluster rows from Lakebase."""
    snap = _latest_snapshot_payload()
    return snap["clusters"]


@app.get("/api/clusters/{cluster_id}")
def get_cluster(
    cluster_id: str,
    workspace: Optional[str] = Query(default=None, description="Restrict to a single workspace name"),
):
    """Return a cluster from the latest Lakebase snapshot (no live SDK fetch)."""
    for row in _latest_snapshot_payload()["clusters"]:
        if row.get("id") == cluster_id and (not workspace or row.get("workspace") == workspace):
            return row
    raise HTTPException(status_code=404, detail=f"Cluster {cluster_id!r} not found in latest snapshot")


@app.get("/api/warehouses")
def get_warehouses():
    return _latest_snapshot_payload()["warehouses"]


@app.get("/api/pipelines")
def get_pipelines():
    return _latest_snapshot_payload()["pipelines"]


@app.get("/api/job-runs")
def get_job_runs():
    return _latest_snapshot_payload()["job_runs"]


@app.get("/api/history")
def get_history(hours: int = Query(default=24, ge=1, le=168)):
    if not history_backend.is_available:
        return {"available": False, "changes": [], "uptime": []}
    try:
        changes = history_backend.get_state_changes(hours=hours)
        uptime  = history_backend.get_uptime_summary(hours=hours)
        return {
            "available": True,
            "changes": [_serialize(dict(r)) for r in changes],
            "uptime":   [_serialize(dict(r)) for r in uptime],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _latest_snapshot_payload() -> dict:
    """Shared helper for GET /api/snapshot/latest and read-only list routes."""
    empty = {
        "available": False,
        "snapshot_time": None,
        "scrape_run_id": None,
        "scrape_status": None,
        "clusters": [],
        "warehouses": [],
        "pipelines": [],
        "job_runs": [],
    }
    if not history_backend.is_available:
        return empty
    try:
        snap = history_backend.get_latest_snapshot()
        scrape = None
        if hasattr(history_backend, "get_latest_scrape_run"):
            scrape = history_backend.get_latest_scrape_run()
        all_times = [
            r.get("snapshot_time")
            for items in snap.values()
            for r in items
            if r.get("snapshot_time")
        ]
        latest_time = max(all_times) if all_times else None
        if scrape and scrape.get("finished_at"):
            ft = scrape["finished_at"]
            latest_time = ft.isoformat() if hasattr(ft, "isoformat") else str(ft)
        elif scrape and scrape.get("started_at") and not latest_time:
            st = scrape["started_at"]
            latest_time = st.isoformat() if hasattr(st, "isoformat") else str(st)
        return {
            "available": True,
            "snapshot_time": latest_time,
            "scrape_run_id": (scrape or {}).get("run_id"),
            "scrape_status": (scrape or {}).get("status"),
            "scrape_counts": _serialize((scrape or {}).get("counts") or {}),
            "clusters":   [_serialize(r) for r in snap.get("cluster",   [])],
            "warehouses": [_serialize(r) for r in snap.get("warehouse", [])],
            "pipelines":  [_serialize(r) for r in snap.get("pipeline",  [])],
            "job_runs":   [_serialize(r) for r in snap.get("job_run",   [])],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/snapshot/latest")
def get_latest_snapshot():
    """Return the most recent classic-job snapshot for every resource.

    This is the primary data source for the read-only App UI.
    """
    return _latest_snapshot_payload()


@app.post("/api/snapshot/trigger")
def trigger_snapshot():
    """Kick off the classic scrape job (best-effort Refresh).

    Requires the App SP to have CAN_MANAGE_RUN on cluster-monitor-snapshot.
    Returns immediately with the Databricks job run_id; poll GET /api/snapshot/latest
    until scrape_run_id advances.
    """
    job_name = os.getenv("SNAPSHOT_JOB_NAME", "cluster-monitor-snapshot")
    try:
        from databricks.sdk import WorkspaceClient
        w = WorkspaceClient()
        job_id = None
        # Prefer explicit id from env (set after bundle deploy)
        env_job_id = os.getenv("SNAPSHOT_JOB_ID", "").strip()
        if env_job_id:
            job_id = int(env_job_id)
        else:
            for j in w.jobs.list(name=job_name):
                # Prefer exact name match; development mode prefixes "[dev user] "
                settings_name = (j.settings.name if j.settings else "") or ""
                if settings_name == job_name or settings_name.endswith(job_name):
                    job_id = j.job_id
                    break
            if job_id is None:
                # Fallback: first list hit for substring
                for j in w.jobs.list():
                    settings_name = (j.settings.name if j.settings else "") or ""
                    if job_name in settings_name:
                        job_id = j.job_id
                        break
        if job_id is None:
            raise HTTPException(
                status_code=404,
                detail=f"Scrape job {job_name!r} not found. Deploy the bundle or set SNAPSHOT_JOB_ID.",
            )
        run = w.jobs.run_now(job_id=job_id)
        return {
            "ok": True,
            "job_id": job_id,
            "job_name": job_name,
            "run_id": run.run_id,
            "message": "Classic scrape job started. Poll /api/snapshot/latest for new data.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/compute/stream")
async def stream_compute_sse():
    """Deprecated — live multi-workspace scrape from the App is disabled.

    Use classic-compute job + GET /api/snapshot/latest instead.
    """
    raise HTTPException(
        status_code=410,
        detail=(
            "Live SSE scrape is disabled. The App is Lakebase-read-only; "
            "run the classic cluster-monitor-snapshot job and poll /api/snapshot/latest."
        ),
    )


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------

class SettingsPayload(BaseModel):
    lakebase:     dict
    json_storage: dict
    account_sp:   dict = {}
    workspaces:   list = []


@app.get("/api/settings")
def get_settings():
    # to_dict() redacts client_secret
    return _current_settings.to_dict()


@app.put("/api/settings")
def put_settings(payload: SettingsPayload):
    global history_backend, _current_settings

    raw = payload.model_dump()

    # If the frontend sends an empty client_secret (redacted placeholder),
    # preserve whatever is already stored on disk so we don't accidentally
    # wipe the real secret.
    incoming_secret = (raw.get("account_sp") or {}).get("client_secret", "")
    if not incoming_secret:
        raw.setdefault("account_sp", {})
        raw["account_sp"]["client_secret"] = _current_settings.account_sp.client_secret

    new_settings = AppSettings.from_dict(raw)

    # Prefer Lakebase — survives all deploys and requires no writable filesystem.
    # Fall back to the local file (useful for local dev where Lakebase isn't running).
    if isinstance(history_backend, LakebaseBackend) and history_backend.is_available:
        try:
            history_backend.save_app_settings(new_settings.to_disk_dict())
        except Exception as exc:
            msg = f"Failed to save settings to Lakebase: {exc}"
            print(f"ERROR: {msg}", file=sys.stderr)
            return JSONResponse(status_code=500, content={"saved": False, "error": msg})
    else:
        try:
            save_settings(new_settings)
        except OSError as exc:
            msg = (
                f"Failed to save settings to file ({type(exc).__name__}): {exc}. "
                f"Path: {settings_module.SETTINGS_PATH!r}. "
                "In Databricks Apps, settings are normally saved to Lakebase — "
                "ensure LAKEBASE_ENDPOINT is configured."
            )
            print(f"ERROR: {msg}", file=sys.stderr)
            return JSONResponse(status_code=500, content={"saved": False, "error": msg})

    _current_settings = new_settings
    set_current_settings(_current_settings)
    try:
        history_backend.shutdown()
    except Exception:
        pass
    history_backend = _make_backend(new_settings)
    backend_type = (
        "lakebase" if isinstance(history_backend, LakebaseBackend) and history_backend.is_available
        else "json" if isinstance(history_backend, JsonFileBackend) and history_backend.is_available
        else "none"
    )
    return {"saved": True, "backend": backend_type, "available": history_backend.is_available}


class TestLakebasePayload(BaseModel):
    endpoint: str
    database: str = "databricks_postgres"


class TestJsonPayload(BaseModel):
    path: str


@app.post("/api/settings/test-lakebase")
def post_test_lakebase(payload: TestLakebasePayload):
    return test_lakebase(payload.endpoint, payload.database)


@app.post("/api/settings/test-json")
def post_test_json(payload: TestJsonPayload):
    return test_json_path(payload.path)


@app.get("/api/workspaces")
def get_workspaces():
    """Return configured workspaces with name, host, enabled, and current flags.

    Priority:
      1. settings.json workspaces list (if populated)
      2. WORKSPACE_CONFIGS env var (legacy)
      3. Current workspace only (default)
    """
    from databricks.sdk import WorkspaceClient as _WC
    try:
        current_host = (_WC().config.host or "").rstrip("/")
    except Exception:
        current_host = ""

    # 1. In-memory settings (loaded from Lakebase at startup, or file in local dev)
    if _current_settings.workspaces:
        return [
            {
                "name":         w.name,
                "host":         w.host,
                "region":       w.region,
                "enabled":      w.enabled,
                "current":      w.current or (w.host.rstrip("/") == current_host),
                "workspace_id": w.workspace_id,
            }
            for w in _current_settings.workspaces
        ]

    # 2. Legacy WORKSPACE_CONFIGS env var
    import json as _json
    configs_raw = os.getenv("WORKSPACE_CONFIGS", "")
    if configs_raw:
        try:
            configs = _json.loads(configs_raw)
            return [
                {
                    "name":    c["name"],
                    "host":    c["host"].rstrip("/"),
                    "enabled": True,
                    "current": c["host"].rstrip("/") == current_host,
                }
                for c in configs
            ]
        except Exception:
            pass

    # 3. Default: current workspace only
    if current_host:
        name = current_host.replace("https://", "").split(".")[0]
        return [{"name": name, "host": current_host, "enabled": True, "current": True}]
    return []


@app.get("/api/workspaces/discover")
def discover_workspaces():
    """Use the account-level SP (from settings.json) to list all workspaces.

    Returns {"ok": bool, "workspaces": [...], "message"?: str, "error"?: str}
    """
    from databricks.sdk import WorkspaceClient as _WC
    try:
        current_host = (_WC().config.host or "").rstrip("/")
    except Exception:
        current_host = ""

    acct    = _current_settings.account_sp
    timeout = int(getattr(_current_settings, "request_timeout_seconds", 30) or 30)

    if acct.account_id and acct.client_id and acct.client_secret:
        try:
            from api.auth_helpers import account_client_sp as _ac_sp
            a = _ac_sp(acct.account_id, acct.client_id, acct.client_secret, timeout_s=timeout)
            results = []
            skipped = []
            for ws in a.workspaces.list():
                ws_status = getattr(ws, "workspace_status", None)
                # SDK returns a WorkspaceStatus enum; use .value for the string form.
                status = (ws_status.value if hasattr(ws_status, "value") else str(ws_status or "")).upper()
                # Only surface workspaces that are fully running — non-running
                # workspaces cannot have active compute and clutter the list.
                if ws_status is not None and status != "RUNNING":
                    skipped.append(f"{ws.workspace_name or ws.deployment_name} ({status or 'UNKNOWN'})")
                    continue
                host = f"https://{ws.deployment_name}.azuredatabricks.net".rstrip("/")
                # Extract region from whatever field the SDK exposes.
                # Azure: ws.location ("eastus", "westeurope", ...)
                # AWS:   ws.aws_region ("us-east-1", ...)
                # GCP:   not reliably available; fall back to empty string.
                region = (
                    getattr(ws, "location", None)
                    or getattr(ws, "aws_region", None)
                    or ""
                )
                results.append({
                    "name":         ws.workspace_name or ws.deployment_name,
                    "host":         host,
                    "region":       region,
                    "current":      host == current_host,
                    "workspace_id": int(ws.workspace_id or 0),
                })
            msg = f"Found {len(results)} running workspace{'s' if len(results) != 1 else ''}"
            if skipped:
                msg += f" ({len(skipped)} non-running excluded: {', '.join(skipped[:5])}{'…' if len(skipped) > 5 else ''})"
            return {"ok": True, "workspaces": results, "message": msg}
        except Exception as exc:
            return {"ok": False, "workspaces": [], "error": str(exc)}

    # No credentials configured — return current workspace only
    name = current_host.replace("https://", "").split(".")[0] if current_host else "current"
    return {
        "ok": True,
        "workspaces": [{"name": name, "host": current_host, "current": True}],
        "message": "No account credentials configured — showing current workspace only.",
    }


class WorkspacesConfigPayload(BaseModel):
    workspaces: list


@app.post("/api/workspaces/config")
def post_workspaces_config(payload: WorkspacesConfigPayload):
    """Save the workspace enabled/disabled list to settings.json."""
    global _current_settings
    ws_configs = [
        WorkspaceConfig(
            name=w.get("name", ""),
            host=(w.get("host") or "").rstrip("/"),
            region=w.get("region", ""),
            enabled=bool(w.get("enabled", True)),
            current=bool(w.get("current", False)),
            workspace_id=int(w.get("workspace_id") or 0),
        )
        for w in payload.workspaces
        if isinstance(w, dict) and w.get("name") and w.get("host")
    ]
    # Ensure the current workspace is always enabled
    try:
        from databricks.sdk import WorkspaceClient as _WC
        current_host = (_WC().config.host or "").rstrip("/")
        for wc in ws_configs:
            if wc.host.rstrip("/") == current_host:
                wc.enabled = True
                wc.current = True
    except Exception:
        pass

    _current_settings.workspaces = ws_configs
    set_current_settings(_current_settings)
    if isinstance(history_backend, LakebaseBackend) and history_backend.is_available:
        history_backend.save_app_settings(_current_settings.to_disk_dict())
    else:
        save_settings(_current_settings)
    return {
        "saved": True,
        "workspaces": [
            {"name": w.name, "host": w.host, "region": w.region, "enabled": w.enabled,
             "current": w.current, "workspace_id": w.workspace_id}
            for w in ws_configs
        ],
    }


# ---------------------------------------------------------------------------
# Workspace permission check + auto-grant endpoints
# ---------------------------------------------------------------------------

class CheckPermissionsPayload(BaseModel):
    hosts: list  # list of workspace host strings


@app.post("/api/workspaces/check-permissions")
def check_workspace_permissions(payload: CheckPermissionsPayload):
    """Check whether the configured SP has admin access to each listed workspace.

    Runs all checks in parallel; each SDK call is bounded by request_timeout_seconds.
    Returns {"results": {host: {"accessible": bool, "is_admin": bool, "error"?: str}}}
    """
    from api.auth_helpers import workspace_client_sp as _ws_sp

    acct    = _current_settings.account_sp
    timeout = int(getattr(_current_settings, "request_timeout_seconds", 30) or 30)

    if not (acct.client_id and acct.client_secret):
        return {"results": {}, "error": "No SP credentials configured."}

    def _check_one(host: str) -> tuple[str, dict]:
        host = host.rstrip("/")
        try:
            ws = _ws_sp(host, acct.client_id, acct.client_secret, timeout_s=timeout)
            me = ws.current_user.me()
            is_admin = any(
                getattr(g, "display", None) == "admins"
                for g in (getattr(me, "groups", None) or [])
            )
            return host, {"accessible": True, "is_admin": is_admin}
        except Exception as exc:
            err = str(exc)
            accessible = not any(kw in err.lower() for kw in
                                  ("unauthorized", "403", "forbidden", "not a member"))
            return host, {"accessible": accessible, "is_admin": False, "error": err}

    hosts = [h.rstrip("/") for h in payload.hosts if (h or "").strip()]
    if not hosts:
        return {"results": {}}

    results: dict = {}
    max_workers = min(len(hosts), 20)
    # overall_timeout gives every workspace its own timeout window (parallel),
    # plus a small buffer for setup / lock contention.
    overall_timeout = timeout + 10

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_host = {executor.submit(_check_one, h): h for h in hosts}
        done, not_done = concurrent.futures.wait(
            future_to_host.keys(), timeout=overall_timeout
        )
        for fut in done:
            try:
                host, result = fut.result()
                results[host] = result
            except Exception as exc:
                host = future_to_host[fut]
                results[host] = {"accessible": False, "is_admin": False, "error": str(exc)}
        for fut in not_done:
            fut.cancel()
            host = future_to_host[fut]
            results[host] = {
                "accessible": False, "is_admin": False,
                "error": f"Timed out after {overall_timeout}s — workspace may be unreachable",
            }

    return {"results": results}


class GrantAdminPayload(BaseModel):
    workspace_ids: list  # list of numeric workspace IDs


@app.post("/api/workspaces/grant-admin")
def grant_workspace_admin(payload: GrantAdminPayload):
    """Grant the configured SP workspace-admin on each listed workspace.

    Uses the account-level WorkspaceAssignment API (requires the SP to be an
    Account Admin so it can assign itself).

    Returns {"results": {workspace_id: {"success": bool, "error"?: str}}}
    """
    from api.auth_helpers import account_client_sp as _ac_sp

    acct    = _current_settings.account_sp
    timeout = int(getattr(_current_settings, "request_timeout_seconds", 30) or 30)
    if not (acct.account_id and acct.client_id and acct.client_secret):
        return {"results": {}, "error": "No SP credentials configured."}

    try:
        from databricks.sdk.service.iam import WorkspacePermission
        a = _ac_sp(acct.account_id, acct.client_id, acct.client_secret, timeout_s=timeout)

        # Resolve SP's numeric principal_id via account SCIM
        principal_id: int | None = None
        try:
            sp_list = list(a.service_principals.list(filter=f'applicationId eq "{acct.client_id}"'))
            if sp_list:
                principal_id = int(sp_list[0].id)
        except Exception:
            pass

        # Fallback: iterate all SPs and match on applicationId (may be numeric int)
        if principal_id is None:
            try:
                for sp in a.service_principals.list():
                    if str(sp.application_id) == acct.client_id or str(sp.id) == acct.client_id:
                        principal_id = int(sp.id)
                        break
            except Exception:
                pass

        if principal_id is None:
            return {
                "results": {},
                "error": (
                    "Could not find the service principal in account SCIM. "
                    "Ensure the Client ID matches an account-level service principal."
                ),
            }

        results: dict = {}
        for ws_id in payload.workspace_ids:
            ws_id_int = int(ws_id)
            try:
                a.workspace_assignment.update(
                    workspace_id=ws_id_int,
                    principal_id=principal_id,
                    permissions=[WorkspacePermission.ADMIN],
                )
                results[str(ws_id_int)] = {"success": True}
            except Exception as exc:
                results[str(ws_id_int)] = {"success": False, "error": str(exc)}

        return {"results": results}

    except Exception as exc:
        return {"results": {}, "error": str(exc)}


# ---------------------------------------------------------------------------
# Auth validation endpoints
# ---------------------------------------------------------------------------

class ValidateSpPayload(BaseModel):
    account_id:    str
    client_id:     str
    client_secret: str = ""   # empty = use stored secret


@app.post("/api/auth/validate/sp")
def validate_sp(payload: ValidateSpPayload):
    """Test SP credentials by listing account-level workspaces.

    If client_secret is empty the stored value is used, so the form can
    send a blank password field when the user hasn't changed it.
    """
    account_id    = payload.account_id.strip()
    client_id     = payload.client_id.strip()
    client_secret = payload.client_secret.strip()

    if not account_id or not client_id:
        return {"ok": False, "message": "Account ID and Client ID are required."}

    if not client_secret:
        client_secret = _current_settings.account_sp.client_secret
    if not client_secret:
        return {"ok": False, "message": "Client secret is required (or save settings first so the stored value can be used)."}

    try:
        from api.auth_helpers import account_client_sp as _ac_sp  # noqa: PLC0415
        timeout = int(getattr(_current_settings, "request_timeout_seconds", 30) or 30)
        a = _ac_sp(account_id, client_id, client_secret, timeout_s=timeout)
        workspaces = list(a.workspaces.list())
        n = len(workspaces)
        return {"ok": True, "message": f"Connected — found {n} workspace{'s' if n != 1 else ''}."}
    except Exception as exc:
        msg = str(exc)
        hint = ""
        if "invalid_client" in msg:
            hint = (
                " — Checklist: (1) Account ID must be the Databricks account UUID at "
                "accounts.azuredatabricks.net (not Azure tenant/subscription). "
                "(2) The SP must be account-level, not workspace-only. "
                "(3) The Client Secret must be an OAuth secret generated in "
                "Account Console → Service Principals → [SP] → Secrets → Generate secret "
                "(NOT a Personal Access Token)."
            )
        elif "invalid_request" in msg:
            hint = " — One or more required fields may be malformed or missing."
        elif "PERMISSION_DENIED" in msg or "permission_denied" in msg:
            hint = " — The SP authenticated but lacks Account Admin or Can View on the account."
        return {"ok": False, "message": msg + hint}


@app.get("/api/me")
def get_me():
    """Return the identity the app is currently running as (user or service principal)."""
    try:
        from databricks.sdk import WorkspaceClient
        w = WorkspaceClient()
        me = w.current_user.me()
        return {
            "user_name":    me.user_name or "",
            "display_name": me.display_name or me.user_name or "",
            "is_service_principal": "@" not in (me.user_name or ""),
        }
    except Exception as exc:
        return {"user_name": "", "display_name": "unknown", "is_service_principal": False, "error": str(exc)}


@app.get("/api/health")
def health():
    backend_type = (
        "lakebase" if isinstance(history_backend, LakebaseBackend)
        else "json"
    )

    # Derive workspace host and Lakebase project ID from SDK / env vars
    workspace_host = ""
    try:
        from databricks.sdk import WorkspaceClient
        workspace_host = WorkspaceClient().config.host or ""
    except Exception:
        pass

    # LAKEBASE_ENDPOINT format: projects/<project-id>/branches/<branch>/endpoints/primary
    lakebase_endpoint = os.getenv("LAKEBASE_ENDPOINT", "")
    lakebase_project_id = lakebase_endpoint.split("/")[1] if lakebase_endpoint else ""

    return {
        "status":              "ok",
        "history":             history_backend.is_available,
        "backend":             backend_type,
        "mode":                "classic-scraper-readonly",
        "bundle_target":       os.getenv("BUNDLE_TARGET", ""),
        "workspace_host":      workspace_host.rstrip("/"),
        "lakebase_project_id": lakebase_project_id,
        "lakebase_schema":     os.getenv("LAKEBASE_SCHEMA", "cluster_monitor"),
        "snapshot_job_name":   os.getenv("SNAPSHOT_JOB_NAME", "cluster-monitor-snapshot"),
    }


# --- Serve React build (must be last) ---
_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")

if os.path.isdir(_DIST):
    _ASSETS = os.path.join(_DIST, "assets")
    if os.path.isdir(_ASSETS):
        app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_react(full_path: str):
        index = os.path.join(_DIST, "index.html")
        if not os.path.exists(index):
            raise HTTPException(status_code=503, detail="Frontend not built")
        return FileResponse(index)
