"""Classic job-compute scrape task — multi-workspace SDK/REST → Volume staging.

Runs on a classic single-node job cluster (VNet / Private Link friendly) so
spoke workspace APIs are reachable. Does NOT write Lakebase (often unreachable
from classic egress). The serverless sync task loads the staging file next.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import snapshot_common as common

common.ensure_project_path()
common.apply_cli_overrides()

from api.compute import (  # noqa: E402
    fetch_clusters,
    fetch_warehouses,
    fetch_pipelines,
    fetch_job_runs,
    get_scrape_errors,
    reset_scrape_errors,
)
from api.settings import (  # noqa: E402
    AppSettings,
    load_settings,
    set_current_settings,
)


def _load_scrape_settings() -> AppSettings:
    """Settings for classic scrape — prefer Volume cache, then disk/env.

    Lakebase is intentionally skipped here: classic compute often cannot reach it.
    The serverless sync task refreshes <staging>/app_settings.json after each run.
    """
    cached = common.load_settings_cache()
    if cached:
        try:
            settings = AppSettings.from_dict(cached)
            set_current_settings(settings)
            print(
                f"Loaded settings from staging cache — "
                f"{len(settings.workspaces)} workspace(s), "
                f"account_sp={'yes' if settings.account_sp.client_id else 'no'}"
            )
            return settings
        except Exception as exc:
            print(f"WARNING: staging settings cache invalid: {exc}", file=sys.stderr)

    settings = load_settings()
    set_current_settings(settings)
    print(
        f"Loaded settings from disk/env — "
        f"{len(settings.workspaces)} workspace(s), "
        f"account_sp={'yes' if settings.account_sp.client_id else 'no'}"
    )
    if not settings.workspaces and not settings.account_sp.client_id:
        print(
            "NOTE: No workspaces/account SP in cache or disk. "
            "Configure them in the App (saved to Lakebase), then run sync once "
            f"to write {common.settings_cache_path()}, or set WORKSPACE_CONFIGS.",
            file=sys.stderr,
        )
    return settings


def main() -> None:
    print(f"SNAPSHOT_STAGING_PATH={os.getenv('SNAPSHOT_STAGING_PATH')}")
    print(f"mode=scrape (classic job compute)")

    _load_scrape_settings()
    from api.settings import get_current_settings

    enabled = [w for w in get_current_settings().workspaces if w.enabled]
    print(f"Starting classic scrape — {len(enabled) or 'default'} enabled workspace(s)")

    run_id = common.new_run_id()
    print(f"scrape_run_id={run_id}")
    common.try_set_task_value("scrape_run_id", run_id)

    reset_scrape_errors()
    resources = common.empty_resources()
    results: dict[str, int] = {}
    errors: list[str] = []

    for label, fetcher, rtype in [
        ("clusters", fetch_clusters, "cluster"),
        ("warehouses", fetch_warehouses, "warehouse"),
        ("pipelines", fetch_pipelines, "pipeline"),
        ("job_runs", fetch_job_runs, "job_run"),
    ]:
        try:
            items = fetcher()
            resources[rtype] = items
            results[label] = len(items)
            print(f"  ✓ {label}: {len(items)} fetched")
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"  ✗ {label}: {exc}", file=sys.stderr)

    # A workspace that failed (cert validation, private link, auth) must not be
    # published as a partial inventory — Lakebase would look complete but isn't.
    for err in get_scrape_errors():
        errors.append(f"{err['phase']}@{err['workspace']}: {err['message']}")

    status = "failed" if errors else "completed"
    payload = {
        "run_id": run_id,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "counts": results,
        "error": "; ".join(errors) if errors else None,
        "resources": resources,
    }
    common.write_scrape_payload(payload)

    total = sum(results.values())
    print(f"\nScrape {status} — {total} records staged for Lakebase sync")
    if errors:
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        raise RuntimeError(f"{len(errors)} scrape error(s): {'; '.join(errors)}")


if __name__ == "__main__":
    main()
