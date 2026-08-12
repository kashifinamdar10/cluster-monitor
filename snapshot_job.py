"""Databricks Job task: capture a point-in-time snapshot of all compute resources.

Runs on a schedule (e.g. every 5 minutes via the DAB job resource).
Fetches live state from all configured workspaces and writes to the configured
history backend (Lakebase or JSON file on a Volume).

Environment variables (injected by the Databricks Job runtime):
  LAKEBASE_ENDPOINT      — full endpoint resource name (same workspace as job)
  LAKEBASE_DATABASE_NAME — target database (default: databricks_postgres)
  SNAPSHOT_FILE_PATH     — JSONL Volume path, used when Lakebase is not set
  WORKSPACE_CONFIGS      — optional JSON array of extra workspace configs

Designed to run as a serverless Python task — no Spark cluster required.
"""
import sys
import os

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
from api.settings import load_settings
from backend import LakebaseBackend, JsonFileBackend


def main() -> None:
    settings = load_settings()

    if settings.lakebase.endpoint:
        backend = LakebaseBackend()
    elif settings.json_storage.enabled and settings.json_storage.path:
        backend = JsonFileBackend(settings.json_storage.path)
    else:
        print(
            "No history backend configured — nothing to snapshot.\n"
            "Set LAKEBASE_ENDPOINT or SNAPSHOT_FILE_PATH (with SNAPSHOT_FILE_ENABLED=true)."
        )
        # Return (not sys.exit) — spark_python_task runs via exec(), so sys.exit()
        # raises SystemExit which Databricks marks as INTERNAL_ERROR even for code 0.
        return

    backend.initialize()

    if not backend.is_available:
        print("History backend failed to initialise — exiting.", file=sys.stderr)
        # Raise so the run is clearly marked FAILED (not a silent no-op)
        raise RuntimeError("History backend failed to initialise")

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
            backend.store_snapshot(items, rtype)
            results[label] = len(items)
            print(f"  ✓ {label}: {len(items)} snapshots stored")
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"  ✗ {label}: {exc}", file=sys.stderr)

    total = sum(results.values())
    print(f"\nSnapshot complete — {total} records across {len(results)} resource types")

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        raise RuntimeError(f"{len(errors)} snapshot error(s): {'; '.join(errors)}")


if __name__ == "__main__":
    main()
