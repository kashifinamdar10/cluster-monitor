"""Legacy single-process entrypoint (hub-only / Lakebase-reachable compute).

Prefer the two-task job:
  snapshot_scrape.py  — classic job compute → Volume staging
  snapshot_sync.py    — serverless → Lakebase

Running this file alone still scrapes and writes Lakebase directly (previous
behaviour). Use it only when one compute type can reach both spoke APIs and
Lakebase.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone

import snapshot_common as common

common.ensure_project_path()
common.apply_cli_overrides()

from api.compute import (
    fetch_clusters,
    fetch_warehouses,
    fetch_pipelines,
    fetch_job_runs,
    get_scrape_errors,
    reset_scrape_errors,
)
from api.settings import (
    AppSettings,
    load_settings,
    set_current_settings,
)
from backend import LakebaseBackend, JsonFileBackend


def _load_runtime_settings(backend) -> AppSettings:
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

    if not settings.lakebase.endpoint and os.getenv("LAKEBASE_ENDPOINT"):
        settings.lakebase.endpoint = os.getenv("LAKEBASE_ENDPOINT", "")
    if os.getenv("LAKEBASE_DATABASE_NAME"):
        settings.lakebase.database = os.getenv("LAKEBASE_DATABASE_NAME", "databricks_postgres")

    set_current_settings(settings)
    return settings


def main() -> None:
    print(
        "WARNING: snapshot_job.py is the legacy single-task path. "
        "Prefer scrape (classic) + sync (serverless) tasks.",
        file=sys.stderr,
    )
    print(f"LAKEBASE_ENDPOINT={os.getenv('LAKEBASE_ENDPOINT')}")
    print(f"LAKEBASE_SCHEMA={os.getenv('LAKEBASE_SCHEMA', 'cluster_monitor')}")

    if os.getenv("LAKEBASE_ENDPOINT") or os.getenv("LAKEBASE_PG_URL"):
        backend: LakebaseBackend | JsonFileBackend = LakebaseBackend()
    else:
        disk = load_settings()
        if disk.lakebase.endpoint:
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
        raise RuntimeError("History backend failed to initialise")

    settings = _load_runtime_settings(backend)
    enabled = [w for w in settings.workspaces if w.enabled]
    print(f"Starting scrape — {len(enabled) or 'default'} enabled workspace(s)")

    run_id = f"scrape-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    backend.begin_scrape_run(run_id)
    print(f"scrape_run_id={run_id}")

    reset_scrape_errors()
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

    for err in get_scrape_errors():
        errors.append(f"{err['phase']}@{err['workspace']}: {err['message']}")

    if errors:
        backend.complete_scrape_run(
            run_id, status="failed", counts=results, error="; ".join(errors),
        )
        raise RuntimeError(f"{len(errors)} snapshot error(s): {'; '.join(errors)}")

    backend.complete_scrape_run(run_id, status="completed", counts=results)


if __name__ == "__main__":
    main()
