"""Classic-compute scrape job: sole multi-workspace writer for Cluster Monitor.

Runs on a classic single-node job cluster (VNet / Private Link friendly) and
writes compute snapshots into Lakebase. The Databricks App UI is read-only and
serves tables from these snapshots.

Environment variables (injected by the Databricks Job runtime):
  LAKEBASE_ENDPOINT      — full endpoint resource name (same workspace as job)
  LAKEBASE_DATABASE_NAME — target database (default: databricks_postgres)
  SNAPSHOT_FILE_PATH     — JSONL Volume path, used when Lakebase is not set
  WORKSPACE_CONFIGS      — optional JSON array of extra workspace configs (legacy)

Workspace list + account SP are loaded from Lakebase app_settings (written by
the Settings UI), with disk/env settings.json as fallback.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone

# Ensure project root is on sys.path so api.* and backend can be imported.
#
# spark_python_task runs scripts via exec(compile(f.read(), filename, 'exec')),
# which does NOT set __file__.  Fall back to the frame's co_filename, which IS
# populated from the compile() call with the workspace path of the script.
try:
    _script_dir = os.path.dirname(os.path.abspath(__file__))
except NameError:
    import inspect as _inspect
    _frame = _inspect.currentframe()
    _script_dir = os.path.dirname(os.path.abspath(
        _frame.f_code.co_filename if _frame else sys.argv[0]
    ))
    del _inspect, _frame

sys.path.insert(0, _script_dir)
del _script_dir

from api.compute import fetch_clusters, fetch_warehouses, fetch_pipelines, fetch_job_runs
from api.settings import (
    AppSettings,
    load_settings,
    set_current_settings,
)
from backend import LakebaseBackend, JsonFileBackend


def _load_runtime_settings(backend) -> AppSettings:
    """Prefer Lakebase app_settings (UI-managed); fall back to disk/env."""
    settings = load_settings()

    if isinstance(backend, LakebaseBackend) and backend.is_available:
        raw = backend.load_app_settings()
        if raw:
            try:
                settings = AppSettings.from_dict(raw)
                print(
                    f"Loaded settings from Lakebase — "
                    f"{len(settings.workspaces)} workspace(s), "
                    f"account_sp={'yes' if settings.account_sp.client_id else 'no'}"
                )
            except Exception as exc:
                print(
                    f"WARNING: Failed to parse Lakebase settings, using disk/env: {exc}",
                    file=sys.stderr,
                )

    # Env endpoint wins when settings file has empty lakebase (Apps inject this).
    if not settings.lakebase.endpoint and os.getenv("LAKEBASE_ENDPOINT"):
        settings.lakebase.endpoint = os.getenv("LAKEBASE_ENDPOINT", "")
    if os.getenv("LAKEBASE_DATABASE_NAME"):
        settings.lakebase.database = os.getenv("LAKEBASE_DATABASE_NAME", "databricks_postgres")

    set_current_settings(settings)
    return settings


def main() -> None:
    # Initialize backend first so we can load settings from Lakebase.
    # Endpoint may come from spark_env_vars before settings.json exists.
    if os.getenv("LAKEBASE_ENDPOINT") or os.getenv("LAKEBASE_PG_URL"):
        backend: LakebaseBackend | JsonFileBackend = LakebaseBackend()
    else:
        disk = load_settings()
        if disk.lakebase.endpoint:
            # Ensure env is set for LakebaseBackend module-level config
            os.environ.setdefault("LAKEBASE_ENDPOINT", disk.lakebase.endpoint)
            os.environ.setdefault(
                "LAKEBASE_DATABASE_NAME",
                disk.lakebase.database or "databricks_postgres",
            )
            backend = LakebaseBackend()
        elif disk.json_storage.enabled and disk.json_storage.path:
            backend = JsonFileBackend(disk.json_storage.path)
        else:
            print(
                "No history backend configured — nothing to snapshot.\n"
                "Set LAKEBASE_ENDPOINT or SNAPSHOT_FILE_PATH."
            )
            return

    backend.initialize()
    if not backend.is_available:
        print("History backend failed to initialise — exiting.", file=sys.stderr)
        raise RuntimeError("History backend failed to initialise")

    settings = _load_runtime_settings(backend)
    enabled = [w for w in settings.workspaces if w.enabled]
    print(
        f"Starting classic scrape — "
        f"{len(enabled) or 'default'} enabled workspace(s)"
    )

    run_id = f"scrape-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    backend.begin_scrape_run(run_id)
    print(f"scrape_run_id={run_id}")

    results: dict[str, int] = {}
    errors: list[str] = []

    for label, fetcher, rtype in [
        ("clusters",   fetch_clusters,   "cluster"),
        ("warehouses", fetch_warehouses, "warehouse"),
        ("pipelines",  fetch_pipelines,  "pipeline"),
        ("job_runs",   fetch_job_runs,   "job_run"),
    ]:
        try:
            items = fetcher()
            backend.store_snapshot(items, rtype, run_id=run_id)
            results[label] = len(items)
            print(f"  ✓ {label}: {len(items)} snapshots stored")
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"  ✗ {label}: {exc}", file=sys.stderr)

    total = sum(results.values())
    print(f"\nSnapshot complete — {total} records across {len(results)} resource types")

    if errors:
        backend.complete_scrape_run(
            run_id,
            status="failed",
            counts=results,
            error="; ".join(errors),
        )
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        raise RuntimeError(f"{len(errors)} snapshot error(s): {'; '.join(errors)}")

    backend.complete_scrape_run(run_id, status="completed", counts=results)


if __name__ == "__main__":
    main()
