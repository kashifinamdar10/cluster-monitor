"""Serverless sync task — Volume staging → Lakebase.

Reads the scrape payload written by the classic scrape task and inserts into
Lakebase (reachable from serverless on IP-ACL / public-DNS Lakebase hosts).
Also refreshes <staging>/app_settings.json so the next classic scrape has
workspace + account SP config without talking to Lakebase.
"""
from __future__ import annotations

import os
import sys
from typing import Optional

import snapshot_common as common

common.ensure_project_path()
common.apply_cli_overrides()

from api.settings import load_settings  # noqa: E402
from backend import LakebaseBackend  # noqa: E402


def _init_lakebase() -> LakebaseBackend:
    if not (os.getenv("LAKEBASE_ENDPOINT") or os.getenv("LAKEBASE_PG_URL")):
        disk = load_settings()
        if disk.lakebase.endpoint:
            os.environ.setdefault("LAKEBASE_ENDPOINT", disk.lakebase.endpoint)
            os.environ.setdefault(
                "LAKEBASE_DATABASE_NAME",
                disk.lakebase.database or "databricks_postgres",
            )
        else:
            raise RuntimeError(
                "LAKEBASE_ENDPOINT is required for the sync task "
                "(serverless → Lakebase writer)."
            )

    print(f"LAKEBASE_ENDPOINT={os.getenv('LAKEBASE_ENDPOINT')}")
    print(f"LAKEBASE_SCHEMA={os.getenv('LAKEBASE_SCHEMA', 'cluster_monitor')}")
    try:
        from databricks.sdk.version import __version__ as _sdk_version

        print(f"databricks-sdk={_sdk_version}")
    except Exception:
        pass

    backend = LakebaseBackend()
    backend.initialize()
    if not backend.is_available:
        raise RuntimeError("Lakebase backend failed to initialise")
    return backend


def _export_settings_cache(backend: LakebaseBackend) -> None:
    """Write Lakebase app_settings to Volume for the next classic scrape."""
    try:
        raw = backend.load_app_settings()
        if not raw:
            # Fall back to disk/env so hub-only deploys still seed a cache file
            raw = load_settings().to_disk_dict()
        path = common.write_settings_cache(raw)
        print(f"Exported settings cache → {path}")
    except Exception as exc:
        print(f"WARNING: could not export settings cache: {exc}", file=sys.stderr)


def _resolve_run_id() -> Optional[str]:
    rid = common.try_get_task_value("scrape", "scrape_run_id")
    if rid:
        print(f"Using taskValue scrape_run_id={rid}")
    return rid


def main() -> None:
    print(f"SNAPSHOT_STAGING_PATH={os.getenv('SNAPSHOT_STAGING_PATH')}")
    print("mode=sync (serverless → Lakebase)")

    backend = _init_lakebase()
    # Refresh settings cache early so even a failed sync leaves classic scrape usable
    _export_settings_cache(backend)

    payload = common.read_latest_scrape_payload(run_id=_resolve_run_id())
    run_id = payload["run_id"]
    resources = payload.get("resources") or {}
    counts = payload.get("counts") or {}
    scrape_status = payload.get("status") or "completed"
    scrape_error = payload.get("error")

    print(
        f"Syncing scrape_run_id={run_id} status={scrape_status} "
        f"counts={counts}"
    )

    backend.begin_scrape_run(run_id)

    results: dict[str, int] = {}
    errors: list[str] = []
    for rtype, label in [
        ("cluster", "clusters"),
        ("warehouse", "warehouses"),
        ("pipeline", "pipelines"),
        ("job_run", "job_runs"),
    ]:
        items = resources.get(rtype) or []
        try:
            backend.store_snapshot(items, rtype, run_id=run_id)
            results[label] = len(items)
            print(f"  ✓ {label}: {len(items)} rows → Lakebase")
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"  ✗ {label}: {exc}", file=sys.stderr)

    if scrape_status == "failed" or scrape_error:
        errors.append(f"scrape: {scrape_error or scrape_status}")

    if errors:
        backend.complete_scrape_run(
            run_id,
            status="failed",
            counts=results or counts,
            error="; ".join(errors),
        )
        raise RuntimeError(f"{len(errors)} sync error(s): {'; '.join(errors)}")

    backend.complete_scrape_run(run_id, status="completed", counts=results or counts)
    # Re-export after successful sync (picks up any App settings written mid-run)
    _export_settings_cache(backend)
    print(f"\nSync complete — scrape_run_id={run_id}")


if __name__ == "__main__":
    main()
