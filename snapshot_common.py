"""Shared helpers for the two-task scrape → sync snapshot job.

Flow:
  1. scrape (classic job compute) — multi-workspace SDK/REST → staging JSON on a Volume
  2. sync   (serverless)         — staging JSON → Lakebase

Staging layout under SNAPSHOT_STAGING_PATH (or --staging-path):
  <staging>/runs/<run_id>.json     — full scrape payload
  <staging>/LATEST                 — run_id of the newest completed scrape
  <staging>/app_settings.json      — settings cache for classic scrape (no Lakebase)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional


def ensure_project_path() -> None:
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        import inspect

        frame = inspect.currentframe()
        script_dir = os.path.dirname(
            os.path.abspath(frame.f_code.co_filename if frame else sys.argv[0])
        )
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)


def apply_cli_overrides() -> None:
    """Apply --lakebase-* / --staging-path flags from spark_python_task parameters."""
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg.startswith("--lakebase-endpoint="):
            os.environ["LAKEBASE_ENDPOINT"] = arg.split("=", 1)[1].strip()
        elif arg == "--lakebase-endpoint" and i + 1 < len(args):
            os.environ["LAKEBASE_ENDPOINT"] = args[i + 1].strip()
        elif arg.startswith("--lakebase-database="):
            os.environ["LAKEBASE_DATABASE_NAME"] = arg.split("=", 1)[1].strip()
        elif arg == "--lakebase-database" and i + 1 < len(args):
            os.environ["LAKEBASE_DATABASE_NAME"] = args[i + 1].strip()
        elif arg.startswith("--lakebase-schema="):
            os.environ["LAKEBASE_SCHEMA"] = arg.split("=", 1)[1].strip()
        elif arg == "--lakebase-schema" and i + 1 < len(args):
            os.environ["LAKEBASE_SCHEMA"] = args[i + 1].strip()
        elif arg.startswith("--staging-path="):
            os.environ["SNAPSHOT_STAGING_PATH"] = arg.split("=", 1)[1].strip()
        elif arg == "--staging-path" and i + 1 < len(args):
            os.environ["SNAPSHOT_STAGING_PATH"] = args[i + 1].strip()

    os.environ.setdefault("LAKEBASE_DATABASE_NAME", "databricks_postgres")
    os.environ.setdefault("LAKEBASE_SCHEMA", "cluster_monitor")


def staging_root() -> str:
    raw = (os.getenv("SNAPSHOT_STAGING_PATH") or "").strip()
    if not raw:
        raise RuntimeError(
            "SNAPSHOT_STAGING_PATH / --staging-path is required for scrape↔sync handoff. "
            "Example: /Volumes/<catalog>/<schema>/<volume>/cluster_monitor_staging"
        )
    p = raw.rstrip("/")
    if p.startswith("dbfs:/"):
        p = "/dbfs/" + p[len("dbfs:/") :]
    # Prefer UC FUSE path on classic + serverless job compute
    if p.startswith("/dbfs/Volumes/"):
        p = p[len("/dbfs") :]
    return p


def _runs_dir(root: Optional[str] = None) -> str:
    return os.path.join(root or staging_root(), "runs")


def run_payload_path(run_id: str, root: Optional[str] = None) -> str:
    return os.path.join(_runs_dir(root), f"{run_id}.json")


def latest_pointer_path(root: Optional[str] = None) -> str:
    return os.path.join(root or staging_root(), "LATEST")


def settings_cache_path(root: Optional[str] = None) -> str:
    return os.path.join(root or staging_root(), "app_settings.json")


def normalize_fs_path(path: str) -> str:
    """Return a path open() can use on the current compute type."""
    p = path.strip()
    if p.startswith("dbfs:/"):
        p = "/dbfs/" + p[len("dbfs:/") :]
    # Apps often need /dbfs/Volumes; classic/serverless jobs use /Volumes
    if p.startswith("/Volumes/") and not os.path.exists(os.path.dirname(p) or p):
        alt = "/dbfs" + p
        if os.path.exists(os.path.dirname(alt) or alt):
            return alt
    if p.startswith("/dbfs/Volumes/") and not os.path.exists(os.path.dirname(p) or p):
        alt = p[len("/dbfs") :]
        if os.path.exists(os.path.dirname(alt) or alt):
            return alt
    return p


def ensure_parent(path: str) -> str:
    path = normalize_fs_path(path)
    parent = os.path.dirname(path)
    if parent and not parent.startswith("/Volumes") and not parent.startswith("/dbfs/Volumes"):
        os.makedirs(parent, exist_ok=True)
    elif parent:
        try:
            os.makedirs(parent, exist_ok=True)
        except OSError:
            # Volume root must pre-exist; runs/ subdir usually creatable
            pass
    return path


def write_json(path: str, payload: dict) -> str:
    path = ensure_parent(path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, default=str)
    os.replace(tmp, path)
    return path


def read_json(path: str) -> dict:
    path = normalize_fs_path(path)
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_scrape_payload(payload: dict) -> str:
    root = staging_root()
    run_id = payload["run_id"]
    path = write_json(run_payload_path(run_id, root), payload)
    if payload.get("status") == "completed":
        latest = ensure_parent(latest_pointer_path(root))
        with open(latest, "w", encoding="utf-8") as fh:
            fh.write(run_id)
    print(f"Staging wrote {path}")
    return path


def read_latest_scrape_payload(run_id: Optional[str] = None) -> dict:
    root = staging_root()
    if not run_id:
        latest = normalize_fs_path(latest_pointer_path(root))
        with open(latest, "r", encoding="utf-8") as fh:
            run_id = fh.read().strip()
    if not run_id:
        raise RuntimeError("No scrape run_id — LATEST pointer empty and none provided")
    path = run_payload_path(run_id, root)
    print(f"Staging reading {path}")
    return read_json(path)


def write_settings_cache(settings_dict: dict) -> str:
    """Persist settings for the classic scrape task (cannot rely on Lakebase)."""
    return write_json(settings_cache_path(), settings_dict)


def load_settings_cache() -> Optional[dict]:
    path = normalize_fs_path(settings_cache_path())
    try:
        return read_json(path)
    except FileNotFoundError:
        return None
    except Exception as exc:
        print(f"WARNING: could not read settings cache {path}: {exc}", file=sys.stderr)
        return None


def try_set_task_value(key: str, value: str) -> None:
    try:
        from pyspark.dbutils import DBUtils  # type: ignore
        from pyspark.sql import SparkSession

        spark = SparkSession.builder.getOrCreate()
        DBUtils(spark).jobs.taskValues.set(key=key, value=value)
        print(f"taskValue set {key}={value}")
    except Exception as exc:
        print(f"taskValue unavailable ({exc}) — relying on staging LATEST pointer")


def try_get_task_value(task_key: str, key: str) -> Optional[str]:
    try:
        from pyspark.dbutils import DBUtils  # type: ignore
        from pyspark.sql import SparkSession

        spark = SparkSession.builder.getOrCreate()
        val = DBUtils(spark).jobs.taskValues.get(
            taskKey=task_key, key=key, debugValue=""
        )
        return str(val).strip() or None
    except Exception as exc:
        print(f"taskValue get unavailable ({exc})")
        return None


def new_run_id() -> str:
    import uuid

    return (
        f"scrape-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-"
        f"{uuid.uuid4().hex[:8]}"
    )


def empty_resources() -> dict[str, list]:
    return {"cluster": [], "warehouse": [], "pipeline": [], "job_run": []}
