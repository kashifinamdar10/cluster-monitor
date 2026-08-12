"""Settings management for Cluster Monitor.

Settings are persisted as JSON at SETTINGS_PATH (env var) or a user-configured
path. On startup the app loads from that file; changes via the settings API are
written back immediately.

Schema (all fields optional / have defaults):
{
  "lakebase": {
    "endpoint": "",        // projects/<id>/branches/production/endpoints/primary
    "database": "databricks_postgres"
  },
  "json_storage": {
    "enabled": false,
    "path": ""             // /Volumes/<cat>/<schema>/<vol>/snapshots.jsonl  OR /tmp/...
  },
  "account_sp": {
    "account_id":    "",   // Databricks account UUID
    "client_id":     "",   // OAuth M2M client ID
    "client_secret": ""    // OAuth M2M client secret (stored as-is; redacted on read)
  },
  "workspaces": [
    {"name": "...", "host": "https://...", "enabled": true, "current": true}
  ]
}
"""
import json
import os
import sys
import threading
import time
from dataclasses import dataclass, field, asdict
from typing import List

# Where settings.json lives.
#
# In production (Databricks App) SETTINGS_PATH is injected by app.yaml and
# points to a Unity Catalog Volume:
#   /Volumes/<settings_catalog>/<settings_schema>/config/settings.json
#
# That volume is created by the DABs bundle (resources/cluster_monitor_storage.yml)
# and is NEVER inside the bundle files/ sync directory, so it survives every deploy.
#
# Locally (dev / unit tests) the env var is absent and the file falls back to
# the project root, which is fine for transient local state.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_PATH = os.getenv("SETTINGS_PATH", os.path.join(_PROJECT_ROOT, "settings.json"))

_lock = threading.Lock()


@dataclass
class LakebaseSettings:
    endpoint: str = ""
    database: str = "databricks_postgres"


@dataclass
class JsonStorageSettings:
    enabled: bool = False
    path: str = ""


@dataclass
class AccountSpSettings:
    account_id:    str = ""
    client_id:     str = ""
    client_secret: str = ""


@dataclass
class WorkspaceConfig:
    name:         str  = ""
    host:         str  = ""
    region:       str  = ""
    enabled:      bool = True
    current:      bool = False
    workspace_id: int  = 0  # Numeric Databricks workspace ID; used for permission management


@dataclass
class AppSettings:
    lakebase:                 LakebaseSettings     = field(default_factory=LakebaseSettings)
    json_storage:             JsonStorageSettings  = field(default_factory=JsonStorageSettings)
    account_sp:               AccountSpSettings    = field(default_factory=AccountSpSettings)
    workspaces:               List[WorkspaceConfig] = field(default_factory=list)
    request_timeout_seconds:  int = 30  # Per-request HTTP timeout for SDK calls

    def to_dict(self) -> dict:
        d = asdict(self)
        # Redact SP secret in API responses
        if d.get("account_sp", {}).get("client_secret"):
            d["account_sp"]["client_secret"] = ""
        return d

    def to_disk_dict(self) -> dict:
        """Full serialisation with the client_secret encrypted at rest."""
        from api.crypto import encrypt_secret
        d = asdict(self)
        if d.get("account_sp", {}).get("client_secret"):
            d["account_sp"]["client_secret"] = encrypt_secret(
                d["account_sp"]["client_secret"]
            )
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "AppSettings":
        lb     = d.get("lakebase") or {}
        js     = d.get("json_storage") or {}
        acct   = d.get("account_sp") or {}
        ws_raw = d.get("workspaces") or []
        workspaces = [
            WorkspaceConfig(
                name=w.get("name", ""),
                host=w.get("host", "").rstrip("/"),
                region=w.get("region", ""),
                enabled=bool(w.get("enabled", True)),
                current=bool(w.get("current", False)),
                workspace_id=int(w.get("workspace_id") or 0),
            )
            for w in ws_raw
            if isinstance(w, dict)
        ]
        from api.crypto import decrypt_secret
        return cls(
            lakebase=LakebaseSettings(
                endpoint=lb.get("endpoint", ""),
                database=lb.get("database", "databricks_postgres"),
            ),
            json_storage=JsonStorageSettings(
                enabled=bool(js.get("enabled", False)),
                path=js.get("path", ""),
            ),
            account_sp=AccountSpSettings(
                account_id=acct.get("account_id", ""),
                client_id=acct.get("client_id", ""),
                # decrypt_secret is a no-op for plaintext (no enc: prefix),
                # so API PUT bodies and legacy unencrypted values work unchanged.
                client_secret=decrypt_secret(acct.get("client_secret", "")),
            ),
            workspaces=workspaces,
            request_timeout_seconds=int(d.get("request_timeout_seconds") or 30),
        )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def load_settings() -> AppSettings:
    """Read settings from disk; returns defaults if file doesn't exist."""
    # Seed from environment variables if no file exists yet
    defaults = AppSettings(
        lakebase=LakebaseSettings(
            endpoint=os.getenv("LAKEBASE_ENDPOINT", ""),
            database=os.getenv("LAKEBASE_DATABASE_NAME", "databricks_postgres"),
        ),
        json_storage=JsonStorageSettings(
            enabled=bool(os.getenv("SNAPSHOT_FILE_PATH", "")),
            path=os.getenv("SNAPSHOT_FILE_PATH", ""),
        ),
    )
    try:
        with _lock:
            with open(SETTINGS_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        loaded = AppSettings.from_dict(data)
        # Let env vars override only if the settings file has empty strings
        if not loaded.lakebase.endpoint and defaults.lakebase.endpoint:
            loaded.lakebase.endpoint = defaults.lakebase.endpoint
        if not loaded.json_storage.path and defaults.json_storage.path:
            loaded.json_storage.path = defaults.json_storage.path
            loaded.json_storage.enabled = defaults.json_storage.enabled
        # account_sp and workspaces come entirely from the settings file
        return loaded
    except FileNotFoundError:
        return defaults
    except (json.JSONDecodeError, Exception) as exc:
        print(f"WARNING: Could not load settings from {SETTINGS_PATH}: {exc}", file=sys.stderr)
        return defaults


# ---------------------------------------------------------------------------
# In-memory singleton — authoritative runtime state
# ---------------------------------------------------------------------------
# main.py calls set_current_settings() after loading from Lakebase or disk.
# compute.py and other modules call get_current_settings() instead of
# load_settings() to get the live, Lakebase-backed settings.

_current: "AppSettings | None" = None


def get_current_settings() -> "AppSettings":
    """Return the live in-memory settings (always prefer this over load_settings)."""
    return _current if _current is not None else load_settings()


def set_current_settings(s: "AppSettings") -> None:
    """Update the in-memory singleton — called by main.py on every settings change."""
    global _current
    _current = s


def save_settings(settings: AppSettings) -> None:
    """Write settings to disk atomically (full dict including secret)."""
    parent = os.path.dirname(SETTINGS_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = SETTINGS_PATH + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(settings.to_disk_dict(), fh, indent=2)
        os.replace(tmp, SETTINGS_PATH)


# ---------------------------------------------------------------------------
# Connection tests
# ---------------------------------------------------------------------------

def test_lakebase(endpoint: str, database: str) -> dict:
    """Try connecting to Lakebase via w.postgres OAuth and running SELECT 1.

    Returns {"ok": bool, "message": str, "latency_ms": int | None}
    """
    if not endpoint:
        return {"ok": False, "message": "No endpoint specified.", "latency_ms": None}
    try:
        from databricks.sdk import WorkspaceClient
        import psycopg

        w = WorkspaceClient()
        t0 = time.perf_counter()

        ep = w.postgres.get_endpoint(name=endpoint)
        host = ep.status.hosts.host
        username = w.current_user.me().user_name
        token = w.postgres.generate_database_credential(endpoint=endpoint).token

        conn_str = (
            f"host={host} dbname={database} "
            f"user={username} password={token} sslmode=require"
        )
        with psycopg.connect(conn_str, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()

        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": True,
            "message": f"Connected to {host} as {username}.",
            "latency_ms": latency_ms,
        }
    except Exception as exc:
        return {"ok": False, "message": str(exc), "latency_ms": None}


def normalize_snapshot_path(path: str) -> str:
    """Resolve user-entered path variants to a canonical filesystem path.

    Handles:
      dbfs:/Volumes/...   → /dbfs/Volumes/...   (CLI URI → FUSE path)
      /Volumes/...        → /dbfs/Volumes/...   (Databricks Apps mount)
      /dbfs/Volumes/...   → unchanged
      /tmp/... or other   → unchanged

    Also strips trailing slashes and appends /snapshots.jsonl when the path
    looks like a directory (no .jsonl / .json extension).
    """
    p = path.strip()
    # Normalise URI → FUSE path
    if p.startswith("dbfs:/"):
        p = "/dbfs/" + p[len("dbfs:/"):]
    elif p.startswith("/Volumes/"):
        p = "/dbfs" + p          # /Volumes/... → /dbfs/Volumes/...
    # Strip trailing slash, then append filename if needed
    p = p.rstrip("/")
    if not (p.endswith(".jsonl") or p.endswith(".json")):
        p = p + "/snapshots.jsonl"
    return p


def test_json_path(path: str) -> dict:
    """Verify the JSON file path is writable.

    Returns {"ok": bool, "message": str, "resolved_path": str}

    For /dbfs/Volumes paths os.makedirs is intentionally skipped — the FUSE
    namespace traversal raises PermissionError even with exist_ok=True.
    The directory must already exist inside the volume; we just probe the file.
    """
    if not path:
        return {"ok": False, "message": "No path specified."}

    resolved = normalize_snapshot_path(path)
    note = ""
    if resolved != path.strip():
        note = f" (resolved to: {resolved})"

    try:
        # For non-volume paths, create the parent directory if missing.
        if not resolved.startswith("/dbfs/Volumes/"):
            parent = os.path.dirname(resolved)
            if parent:
                os.makedirs(parent, exist_ok=True)

        # Probe write access (append mode preserves existing content)
        with open(resolved, "a", encoding="utf-8") as fh:
            fh.write("")

        return {
            "ok": True,
            "message": f"Path is writable{note}: {resolved}",
            "resolved_path": resolved,
        }
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
