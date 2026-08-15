"""Persistence backends for cluster/warehouse state history.

Two backends are available; the app uses whichever is configured:

LakebaseBackend  -- autoscaling Lakebase project via w.postgres OAuth.
  Auth uses the running identity (app SP or dev user); requires LAKEBASE_ENDPOINT
  env var or settings.json. Schema defaults to cluster_monitor; override with
  LAKEBASE_SCHEMA (e.g. cluster_monitor_v2) for side-by-side App versions.
  Token is refreshed every 50 min in a background thread.

JsonFileBackend  -- appends JSONL to any writable path.
  Works with Databricks Volumes (/Volumes/...), /tmp, or a local dev path.
  No external service required; configure via SNAPSHOT_FILE_PATH or settings.json.

Connection priority:
  1. LAKEBASE_PG_URL   -- static PostgreSQL URL (local dev / CI only)
  2. LAKEBASE_ENDPOINT -- autoscaling endpoint resource name
"""
import os
import json
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

from databricks.sdk import WorkspaceClient

# psycopg is imported lazily inside methods so that importing this module never
# fails in environments where psycopg[binary] is not installed (e.g. the app
# startup before the package list is read, or lightweight test runners).

# ── Configuration ─────────────────────────────────────────────────────────────
# Resolved at initialize()-time so spark_env_vars / late os.environ updates apply.
TOKEN_REFRESH_INTERVAL = 50 * 60   # seconds (refresh well before 1-hour expiry)


def _lakebase_endpoint() -> str:
    return os.getenv("LAKEBASE_ENDPOINT", "")


def _lakebase_database() -> str:
    return os.getenv("LAKEBASE_DATABASE_NAME", "databricks_postgres")


def _lakebase_schema() -> str:
    """Postgres schema for snapshots/settings (LAKEBASE_SCHEMA, default cluster_monitor).

    Use a distinct value (e.g. cluster_monitor_v2) when a prior App SP owns the
    default schema and the new App must create its own tables.
    """
    raw = (os.getenv("LAKEBASE_SCHEMA") or "cluster_monitor").strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", raw):
        raise ValueError(
            f"Invalid LAKEBASE_SCHEMA={raw!r} — use letters, digits, underscore only"
        )
    return raw


def _lakebase_pg_url() -> str:
    return os.getenv("LAKEBASE_PG_URL", "")


def _sql(sql: str) -> str:
    """Substitute the configured Lakebase schema into SQL templates.

    Templates use ``{schema}`` placeholders. Safe with psycopg ``%s`` params
    (unlike str.format).
    """
    return sql.replace("{schema}", _lakebase_schema())


# ── Lakebase control-plane calls ──────────────────────────────────────────────
# Databricks Runtime ships its own (often older) databricks-sdk that predates
# w.postgres. Fall back to the same REST endpoints through the generic API
# client so the scrape job runs on any runtime without a library upgrade.

def _pg_endpoint_host(w: WorkspaceClient, name: str) -> str:
    if hasattr(w, "postgres"):
        return w.postgres.get_endpoint(name=name).status.hosts.host
    res = w.api_client.do("GET", f"/api/2.0/postgres/{name}")
    host = ((res or {}).get("status") or {}).get("hosts", {}).get("host")
    if not host:
        raise RuntimeError(
            f"Lakebase endpoint '{name}' returned no host — check the endpoint "
            f"exists and the identity has CAN_USE on the project. Response: {res}"
        )
    return host


def _pg_credential_token(w: WorkspaceClient, name: str) -> str:
    if hasattr(w, "postgres"):
        return w.postgres.generate_database_credential(endpoint=name).token
    res = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": name})
    token = (res or {}).get("token")
    if not token:
        raise RuntimeError(f"Lakebase credential request returned no token: {res}")
    return token


class LakebaseBackend:
    """Manages Lakebase connections and state persistence.

    Thread-safe: token refresh happens in a daemon thread; _conn_string is
    replaced atomically so in-flight queries finish before the next refresh.
    """

    def __init__(self):
        self._token: Optional[str] = None
        self._host: Optional[str] = None
        self._username: Optional[str] = None
        self._conn_string: Optional[str] = None
        self._refresh_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._initialized = False

    # ── Public ────────────────────────────────────────────────────────────────

    def initialize(self) -> None:
        """Set up connection and ensure schema exists."""
        pg_url = _lakebase_pg_url()
        endpoint = _lakebase_endpoint()
        if pg_url:
            self._conn_string = pg_url
            print("Lakebase: using static LAKEBASE_PG_URL (local dev mode)")
        elif endpoint:
            self._setup_oauth_connection()
        else:
            print(
                "WARNING: Lakebase not configured — set LAKEBASE_ENDPOINT to enable history. "
                "Create a project with: databricks postgres create-project cluster-monitor "
                "--json '{\"spec\":{\"display_name\":\"Cluster Monitor\"}}'"
            )
            return

        try:
            self._create_schema()
        except Exception as e:
            print(f"WARNING: Lakebase schema creation failed: {e}")
            # App SP usually owns the tables; classic/serverless jobs may lack DDL rights.
            # If DML works, continue — the App migration path creates scrape_run_id / scrape_runs.
            try:
                with self._get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            _sql("SELECT 1 FROM {schema}.resource_snapshots LIMIT 1")
                        )
                print("Lakebase: existing schema is readable — continuing without DDL")
            except Exception as probe_exc:
                print(f"History will be unavailable until the schema issue is resolved. ({probe_exc})")
                return

        self._initialized = True
        print(f"Lakebase backend ready (endpoint: {endpoint or 'local'}, schema: {_lakebase_schema()})")

    @property
    def is_available(self) -> bool:
        return self._initialized

    def begin_scrape_run(self, run_id: str) -> None:
        """Mark a new classic-job scrape cycle as running."""
        if not self._initialized:
            return
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    INSERT INTO {schema}.scrape_runs
                        (run_id, started_at, status, counts)
                    VALUES (%s, NOW(), 'running', '{}'::jsonb)
                    ON CONFLICT (run_id) DO UPDATE
                        SET started_at = EXCLUDED.started_at,
                            status = 'running',
                            finished_at = NULL,
                            counts = '{}'::jsonb,
                            error = NULL
                    """),
                    (run_id,),
                )
            conn.commit()

    def complete_scrape_run(
        self,
        run_id: str,
        *,
        status: str = "completed",
        counts: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> None:
        """Mark a scrape cycle completed or failed."""
        if not self._initialized:
            return
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    UPDATE {schema}.scrape_runs
                    SET finished_at = NOW(),
                        status = %s,
                        counts = %s::jsonb,
                        error = %s
                    WHERE run_id = %s
                    """),
                    (status, json.dumps(counts or {}), error, run_id),
                )
            conn.commit()

    def get_latest_scrape_run(self) -> Optional[dict]:
        """Return the most recent scrape_runs row (prefer completed)."""
        if not self._initialized:
            return None
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    SELECT run_id, started_at, finished_at, status, counts, error
                    FROM {schema}.scrape_runs
                    WHERE status = 'completed'
                    ORDER BY finished_at DESC NULLS LAST, started_at DESC
                    LIMIT 1
                    """)
                )
                row = cur.fetchone()
                if row:
                    return dict(row)
                cur.execute(
                    _sql("""
                    SELECT run_id, started_at, finished_at, status, counts, error
                    FROM {schema}.scrape_runs
                    ORDER BY started_at DESC
                    LIMIT 1
                    """)
                )
                row = cur.fetchone()
                return dict(row) if row else None

    def store_snapshot(
        self,
        resources: list[dict],
        resource_type: str,
        *,
        run_id: Optional[str] = None,
    ) -> None:
        """Persist a batch of resource states as a point-in-time snapshot."""
        if not self._initialized:
            return

        now = datetime.utcnow()
        rows = [
            (
                now,
                resource_type,
                # job_run uses run_id/run_name; every other type uses id/name
                r.get("id") or r.get("run_id", ""),
                r.get("name") or r.get("run_name", ""),
                r.get("workspace", ""),
                r.get("state", ""),
                r.get("cluster_source", ""),
                r.get("creator", ""),
                json.dumps(r.get("tags", {})),
                json.dumps({
                    k: v for k, v in r.items()
                    if k not in (
                        "id", "name", "workspace", "state",
                        "cluster_source", "creator", "tags", "tag_str",
                        "is_job_cluster", "is_pipeline_cluster",
                    )
                }),
                run_id,
            )
            for r in resources
        ]

        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    _sql("""
                    INSERT INTO {schema}.resource_snapshots
                        (snapshot_time, resource_type, resource_id, resource_name,
                         workspace, state, cluster_source, creator, tags, metadata,
                         scrape_run_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """),
                    rows,
                )
            conn.commit()

    def get_state_changes(
        self,
        hours: int = 24,
        resource_type: Optional[str] = None,
    ) -> list[dict]:
        """Return state transitions (prev → new) in the last *hours* hours."""
        if not self._initialized:
            return []

        since = datetime.utcnow() - timedelta(hours=hours)
        query = _sql("""
            WITH ranked AS (
                SELECT *,
                    LAG(state) OVER (
                        PARTITION BY resource_type, resource_id
                        ORDER BY snapshot_time
                    ) AS prev_state
                FROM {schema}.resource_snapshots
                WHERE snapshot_time > %s
        """)
        params: list = [since]
        if resource_type:
            query += " AND resource_type = %s"
            params.append(resource_type)
        query += """
            )
            SELECT snapshot_time, resource_type, resource_id, resource_name,
                   workspace, prev_state, state, creator
            FROM ranked
            WHERE prev_state IS NOT NULL AND prev_state != state
            ORDER BY snapshot_time DESC
            LIMIT 200
        """

        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return cur.fetchall()

    def get_latest_snapshot(self) -> dict[str, list[dict]]:
        """Return the most recent stored state for every resource (one row per ID).

        Prefer rows from the latest completed scrape_run so the UI sees one
        coherent classic-job cycle. Fall back to DISTINCT ON by time.
        """
        if not self._initialized:
            return {}

        result: dict[str, list[dict]] = {
            "cluster": [], "warehouse": [], "pipeline": [], "job_run": [],
        }
        latest_run = self.get_latest_scrape_run()
        run_id = (latest_run or {}).get("run_id") if (latest_run or {}).get("status") == "completed" else None

        with self._get_conn() as conn:
            with conn.cursor() as cur:
                if run_id:
                    cur.execute(
                    _sql("""
                        SELECT DISTINCT ON (resource_type, resource_id)
                            resource_type, resource_id, resource_name, workspace, state,
                            cluster_source, creator, tags, metadata, snapshot_time,
                            scrape_run_id
                        FROM {schema}.resource_snapshots
                        WHERE scrape_run_id = %s
                        ORDER BY resource_type, resource_id, snapshot_time DESC
                    """), (run_id,))
                else:
                    cur.execute(
                    _sql("""
                        SELECT DISTINCT ON (resource_type, resource_id)
                            resource_type, resource_id, resource_name, workspace, state,
                            cluster_source, creator, tags, metadata, snapshot_time,
                            scrape_run_id
                        FROM {schema}.resource_snapshots
                        ORDER BY resource_type, resource_id, snapshot_time DESC
                    """))
                rows = cur.fetchall()

        for row in rows:
            rtype = row["resource_type"]
            if rtype not in result:
                continue
            rec: dict = {}
            rec.update(row.get("metadata") or {})
            rec["workspace"]      = row["workspace"]
            rec["state"]          = row["state"]
            rec["cluster_source"] = row.get("cluster_source") or ""
            rec["creator"]        = row.get("creator") or ""
            rec["tags"]           = row.get("tags") or {}
            st = row.get("snapshot_time")
            rec["snapshot_time"]  = st.isoformat() if hasattr(st, "isoformat") else str(st or "")

            tags = rec["tags"]
            tag_str = ", ".join(f"{k}={v}" for k, v in tags.items()) if tags else ""

            if rtype == "cluster":
                rec["id"]   = row["resource_id"]
                rec["name"] = row["resource_name"]
                src = rec["cluster_source"]
                rec["is_job_cluster"]      = src == "JOB"
                rec["is_pipeline_cluster"] = src == "PIPELINE"
                rec["tag_str"] = tag_str
            elif rtype == "warehouse":
                rec["id"]      = row["resource_id"]
                rec["name"]    = row["resource_name"]
                rec["tag_str"] = tag_str
            elif rtype == "pipeline":
                rec["id"]   = row["resource_id"]
                rec["name"] = row["resource_name"]
                # latest_updates comes from metadata; default to empty list if absent
                if "latest_updates" not in rec:
                    rec["latest_updates"] = []
            elif rtype == "job_run":
                # resource_id/resource_name were stored as run_id/run_name
                rec["run_id"]  = rec.get("run_id")  or row["resource_id"]
                rec["run_name"] = rec.get("run_name") or row["resource_name"]
                rec["job_id"]  = rec.get("job_id", "")
                # state was set from the dedicated column above
                for field, default in [
                    ("result_state", ""), ("start_time_ms", 0),
                    ("duration_ms", 0), ("trigger", "MANUAL"), ("run_type", "JOB_RUN"),
                ]:
                    if field not in rec:
                        rec[field] = default

            result[rtype].append(rec)

        return result

    def get_history(self, resource_id: str, hours: int = 72) -> list[dict]:
        """Return per-snapshot state history for a single resource."""
        if not self._initialized:
            return []

        since = datetime.utcnow() - timedelta(hours=hours)
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    SELECT snapshot_time, state, resource_name, workspace
                    FROM {schema}.resource_snapshots
                    WHERE resource_id = %s AND snapshot_time > %s
                    ORDER BY snapshot_time DESC
                    LIMIT 500
                    """),
                    (resource_id, since),
                )
                return cur.fetchall()

    def get_uptime_summary(self, hours: int = 24) -> list[dict]:
        """Return per-resource running-time fraction in the last *hours* hours."""
        if not self._initialized:
            return []

        since = datetime.utcnow() - timedelta(hours=hours)
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    SELECT resource_type, resource_id, resource_name, workspace,
                           COUNT(*) AS total_snapshots,
                           SUM(CASE WHEN state = 'RUNNING' THEN 1 ELSE 0 END)
                               AS running_snapshots
                    FROM {schema}.resource_snapshots
                    WHERE snapshot_time > %s
                    GROUP BY resource_type, resource_id, resource_name, workspace
                    ORDER BY running_snapshots DESC
                    """),
                    (since,),
                )
                return cur.fetchall()

    def shutdown(self) -> None:
        """Signal the token-refresh thread to stop."""
        self._stop_event.set()
        if self._refresh_thread:
            self._refresh_thread.join(timeout=5)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _setup_oauth_connection(self) -> None:
        """Resolve endpoint host and generate first OAuth token."""
        w = WorkspaceClient()
        self._host = _pg_endpoint_host(w, _lakebase_endpoint())
        self._username = w.current_user.me().user_name
        self._token = self._generate_token(w)
        self._conn_string = self._build_conn_string()
        self._start_refresh_thread()

    def _generate_token(self, w: Optional[WorkspaceClient] = None) -> str:
        """Generate a fresh OAuth database credential token."""
        if w is None:
            w = WorkspaceClient()
        return _pg_credential_token(w, _lakebase_endpoint())

    def _build_conn_string(self) -> str:
        return (
            f"host={self._host} "
            f"dbname={_lakebase_database()} "
            f"user={self._username} "
            f"password={self._token} "
            f"sslmode=require"
        )

    def _start_refresh_thread(self) -> None:
        """Refresh the OAuth token every 50 minutes in the background."""
        def _loop() -> None:
            while not self._stop_event.wait(TOKEN_REFRESH_INTERVAL):
                try:
                    self._token = self._generate_token()
                    self._conn_string = self._build_conn_string()
                    print("Lakebase: token refreshed")
                except Exception as exc:
                    print(f"Lakebase: token refresh failed — {exc}")

        self._refresh_thread = threading.Thread(target=_loop, daemon=True, name="lakebase-token-refresh")
        self._refresh_thread.start()

    def _get_conn(self):  # -> psycopg.Connection
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(self._conn_string, row_factory=dict_row)

    def _create_schema(self) -> None:
        """Create the app's private schema (owned by the SP) and tables within it."""
        schema = _lakebase_schema()
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                # Create a private schema — the SP will own it because it creates it.
                # This avoids the 'permission denied for schema public' error.
                cur.execute(_sql("CREATE SCHEMA IF NOT EXISTS {schema}"))
                cur.execute(_sql("SET search_path TO {schema}"))
                cur.execute(_sql("""
                    CREATE TABLE IF NOT EXISTS {schema}.resource_snapshots (
                        id              SERIAL PRIMARY KEY,
                        snapshot_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        resource_type   VARCHAR(20)  NOT NULL,
                        resource_id     VARCHAR(255) NOT NULL,
                        resource_name   VARCHAR(500),
                        workspace       VARCHAR(255),
                        state           VARCHAR(50),
                        cluster_source  VARCHAR(50),
                        creator         VARCHAR(255),
                        tags            JSONB DEFAULT '{}',
                        metadata        JSONB DEFAULT '{}'
                    );

                    CREATE INDEX IF NOT EXISTS idx_snapshots_time
                        ON {schema}.resource_snapshots (snapshot_time DESC);
                    CREATE INDEX IF NOT EXISTS idx_snapshots_resource
                        ON {schema}.resource_snapshots (resource_type, resource_id);
                    CREATE INDEX IF NOT EXISTS idx_snapshots_state
                        ON {schema}.resource_snapshots (state);
                """))
                # Existing deployments may pre-date scrape_run_id — add before indexing.
                cur.execute(_sql("""
                    ALTER TABLE {schema}.resource_snapshots
                    ADD COLUMN IF NOT EXISTS scrape_run_id VARCHAR(64)
                """))
                cur.execute(_sql("""
                    CREATE INDEX IF NOT EXISTS idx_snapshots_scrape_run
                        ON {schema}.resource_snapshots (scrape_run_id)
                """))
                cur.execute(_sql("""
                    CREATE TABLE IF NOT EXISTS {schema}.scrape_runs (
                        run_id      VARCHAR(64) PRIMARY KEY,
                        started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        finished_at TIMESTAMPTZ,
                        status      VARCHAR(20) NOT NULL DEFAULT 'running',
                        counts      JSONB DEFAULT '{}',
                        error       TEXT
                    )
                """))
                # Singleton settings row — survives all deploys.
                cur.execute(_sql("""
                    CREATE TABLE IF NOT EXISTS {schema}.app_settings (
                        id          INTEGER PRIMARY KEY DEFAULT 1,
                        data        JSONB    NOT NULL,
                        updated_at  TIMESTAMPTZ DEFAULT NOW(),
                        CONSTRAINT  single_row CHECK (id = 1)
                    )
                """))
                # Allow the classic/serverless scrape job (workspace user / job identity)
                # to INSERT snapshots even when the App SP owns the tables.
                cur.execute(_sql("""
                    GRANT USAGE ON SCHEMA {schema} TO PUBLIC;
                    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA {schema} TO PUBLIC;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO PUBLIC;
                """))
            conn.commit()
            print(f"Lakebase: ensured schema {schema!r} and tables")


    def load_app_settings(self) -> Optional[dict]:
        """Return the saved settings dict, or None if not yet written."""
        if not self._conn_string:
            return None
        try:
            with self._get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                    _sql("SELECT data FROM {schema}.app_settings WHERE id = 1")
                    )
                    row = cur.fetchone()
                    return row["data"] if row else None
        except Exception as exc:
            print(f"Lakebase: failed to load settings — {exc}", file=__import__("sys").stderr)
            return None

    def save_app_settings(self, d: dict) -> None:
        """Upsert the full settings dict (including secrets) to Lakebase."""
        import json as _json
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _sql("""
                    INSERT INTO {schema}.app_settings (id, data, updated_at)
                    VALUES (1, %s, NOW())
                    ON CONFLICT (id) DO UPDATE
                        SET data = EXCLUDED.data, updated_at = NOW()
                    """),
                    (_json.dumps(d),),
                )
            conn.commit()


# ---------------------------------------------------------------------------
# JSON file backend — no external service required
# ---------------------------------------------------------------------------

class JsonFileBackend:
    """Persist snapshots as JSONL to any writable path.

    Each line in the file is a JSON object representing one snapshot record.
    On read, lines are parsed and filtered in memory — suitable for monitoring
    deployments where history only needs to span hours, not weeks.

    Typical paths:
      /Volumes/<catalog>/<schema>/<volume>/cluster_monitor_snapshots.jsonl
      /tmp/cluster_monitor_snapshots.jsonl   (ephemeral — resets on restart)
    """

    def __init__(self, path: str = ""):
        self._path = path.strip()
        self._lock = threading.Lock()
        self._initialized = False

    def initialize(self) -> None:
        if not self._path:
            print("WARNING: JsonFileBackend: no path configured — JSON storage disabled.")
            return
        # Normalise path variants to canonical FUSE path:
        #   dbfs:/Volumes/...  → /dbfs/Volumes/...
        #   /Volumes/...       → /dbfs/Volumes/...  (Apps mount point)
        #   /dbfs/...          → unchanged
        p = self._path.strip()
        if p.startswith("dbfs:/"):
            p = "/dbfs/" + p[len("dbfs:/"):]
        elif p.startswith("/Volumes/"):
            p = "/dbfs" + p
        p = p.rstrip("/")
        if not (p.endswith(".jsonl") or p.endswith(".json")):
            p = p + "/snapshots.jsonl"
        self._path = p
        # Skip makedirs for /dbfs/Volumes paths — FUSE namespace traversal
        # raises PermissionError; the volume directory must already exist.
        if not p.startswith("/dbfs/Volumes/"):
            parent = os.path.dirname(p)
            if parent:
                os.makedirs(parent, exist_ok=True)
        # Verify the file is writable
        with open(self._path, "a", encoding="utf-8") as _:
            pass
        self._initialized = True
        print(f"JsonFileBackend ready → {self._path}")

    @property
    def is_available(self) -> bool:
        return self._initialized

    def store_snapshot(
        self,
        resources: list[dict],
        resource_type: str,
        *,
        run_id: Optional[str] = None,
    ) -> None:
        if not self._initialized:
            return
        now_iso = datetime.utcnow().isoformat()
        lines: list[str] = []
        for r in resources:
            record = {
                "snapshot_time":  now_iso,
                "resource_type":  resource_type,
                # Store canonical id/name for later lookup regardless of field name
                "resource_id":    r.get("id") or r.get("run_id", ""),
                "resource_name":  r.get("name") or r.get("run_name", ""),
                "scrape_run_id":  run_id,
                # Include every original field so type-specific data is preserved
                **r,
            }
            lines.append(json.dumps(record))
        with self._lock:
            with open(self._path, "a", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")

    def begin_scrape_run(self, run_id: str) -> None:
        """No-op for JSON backend — run_id is embedded in snapshot lines."""
        return None

    def complete_scrape_run(
        self,
        run_id: str,
        *,
        status: str = "completed",
        counts: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> None:
        return None

    def get_latest_scrape_run(self) -> Optional[dict]:
        return None

    def _read_records(self, since: datetime) -> list[dict]:
        """Return all records newer than *since*."""
        records: list[dict] = []
        try:
            with self._lock:
                with open(self._path, "r", encoding="utf-8") as fh:
                    lines = fh.readlines()
        except FileNotFoundError:
            return []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                rt = datetime.fromisoformat(r.get("snapshot_time", ""))
                if rt >= since:
                    records.append(r)
            except (json.JSONDecodeError, ValueError):
                continue
        return records

    def get_state_changes(
        self,
        hours: int = 24,
        resource_type: Optional[str] = None,
    ) -> list[dict]:
        if not self._initialized:
            return []
        since = datetime.utcnow() - timedelta(hours=hours)
        records = self._read_records(since)
        if resource_type:
            records = [r for r in records if r["resource_type"] == resource_type]

        # Group by (type, id) and find consecutive state changes
        from collections import defaultdict
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for r in records:
            groups[(r["resource_type"], r["resource_id"])].append(r)

        changes: list[dict] = []
        for items in groups.values():
            items.sort(key=lambda x: x["snapshot_time"])
            for prev, curr in zip(items, items[1:]):
                if prev["state"] != curr["state"]:
                    changes.append({
                        "snapshot_time": curr["snapshot_time"],
                        "resource_type": curr["resource_type"],
                        "resource_id":   curr["resource_id"],
                        "resource_name": curr["resource_name"],
                        "workspace":     curr["workspace"],
                        "prev_state":    prev["state"],
                        "state":         curr["state"],
                        "creator":       curr["creator"],
                    })

        changes.sort(key=lambda x: x["snapshot_time"], reverse=True)
        return changes[:200]

    def get_latest_snapshot(self) -> dict[str, list[dict]]:
        """Return the most recent stored state for every resource (one row per ID)."""
        if not self._initialized:
            return {}

        latest: dict[tuple, dict] = {}
        try:
            with self._lock:
                with open(self._path, "r", encoding="utf-8") as fh:
                    lines = fh.readlines()
        except FileNotFoundError:
            return {}

        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                key = (r.get("resource_type", ""), r.get("resource_id", ""))
                existing = latest.get(key)
                if existing is None or r.get("snapshot_time", "") > existing.get("snapshot_time", ""):
                    latest[key] = r
            except (json.JSONDecodeError, ValueError):
                continue

        result: dict[str, list[dict]] = {
            "cluster": [], "warehouse": [], "pipeline": [], "job_run": [],
        }
        for (rtype, rid), r in latest.items():
            if rtype not in result:
                continue
            # Start from the full stored record (new format has all original fields).
            # For backward-compat with old records that only had core fields,
            # we fall back to extracting what we can.
            src  = r.get("cluster_source", "")
            tags = r.get("tags", {})
            tag_str = ", ".join(f"{k}={v}" for k, v in tags.items()) if tags else ""

            if rtype == "cluster":
                rec = {**r}
                rec.setdefault("id",   r.get("resource_id", ""))
                rec.setdefault("name", r.get("resource_name", ""))
                rec["is_job_cluster"]      = src == "JOB"
                rec["is_pipeline_cluster"] = src == "PIPELINE"
                rec["tag_str"] = tag_str
            elif rtype == "warehouse":
                rec = {**r}
                rec.setdefault("id",   r.get("resource_id", ""))
                rec.setdefault("name", r.get("resource_name", ""))
                rec["tag_str"] = tag_str
                # Defaults for old records that didn't store type-specific fields
                for field, default in [
                    ("size", "Unknown"), ("type", "CLASSIC"),
                    ("auto_stop_mins", 0), ("min_num_clusters", 1),
                    ("max_num_clusters", 1), ("num_clusters", 0),
                    ("num_active_sessions", 0),
                ]:
                    rec.setdefault(field, default)
            elif rtype == "pipeline":
                rec = {**r}
                rec.setdefault("id",   r.get("resource_id", ""))
                rec.setdefault("name", r.get("resource_name", ""))
                rec.setdefault("latest_updates", [])
                rec.setdefault("cluster_id", "")
            elif rtype == "job_run":
                rec = {**r}
                # Prefer stored run_id; fall back to resource_id (our canonical key)
                rec.setdefault("run_id",  rid)
                rec.setdefault("run_name", r.get("resource_name", ""))
                rec.setdefault("job_id",  "")
                rec.setdefault("result_state", "")
                rec.setdefault("start_time_ms", 0)
                rec.setdefault("duration_ms", 0)
                rec.setdefault("trigger", "MANUAL")
                rec.setdefault("run_type", "JOB_RUN")
            else:
                rec = {**r}

            # Strip snapshot-only envelope fields from the resource record
            for key in ("snapshot_time", "resource_type", "resource_id", "resource_name"):
                rec.pop(key, None)
            rec["snapshot_time"] = r.get("snapshot_time", "")

            result[rtype].append(rec)
        return result

    def get_history(self, resource_id: str, hours: int = 72) -> list[dict]:
        if not self._initialized:
            return []
        since = datetime.utcnow() - timedelta(hours=hours)
        records = [
            r for r in self._read_records(since)
            if r["resource_id"] == resource_id
        ]
        records.sort(key=lambda x: x["snapshot_time"], reverse=True)
        return records[:500]

    def get_uptime_summary(self, hours: int = 24) -> list[dict]:
        if not self._initialized:
            return []
        since = datetime.utcnow() - timedelta(hours=hours)
        records = self._read_records(since)

        from collections import defaultdict
        agg: dict[tuple, dict] = defaultdict(lambda: {"total": 0, "running": 0, "name": "", "workspace": ""})
        for r in records:
            key = (r["resource_type"], r["resource_id"])
            agg[key]["total"] += 1
            if r["state"] == "RUNNING":
                agg[key]["running"] += 1
            agg[key]["name"]      = r.get("resource_name", "")
            agg[key]["workspace"] = r.get("workspace", "")

        result = []
        for (rtype, rid), vals in agg.items():
            result.append({
                "resource_type":     rtype,
                "resource_id":       rid,
                "resource_name":     vals["name"],
                "workspace":         vals["workspace"],
                "total_snapshots":   vals["total"],
                "running_snapshots": vals["running"],
            })
        result.sort(key=lambda x: x["running_snapshots"], reverse=True)
        return result

    def shutdown(self) -> None:
        pass  # nothing to clean up

    def rotate_old_records(self, keep_hours: int = 72) -> int:
        """Rewrite the file keeping only records newer than *keep_hours* hours.
        Returns the number of lines dropped. Safe to call from a background thread."""
        if not self._initialized:
            return 0
        cutoff = datetime.utcnow() - timedelta(hours=keep_hours)
        kept: list[str] = []
        dropped = 0
        try:
            with self._lock:
                with open(self._path, "r", encoding="utf-8") as fh:
                    lines = fh.readlines()
                for line in lines:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        r = json.loads(stripped)
                        if datetime.fromisoformat(r.get("snapshot_time", "")) >= cutoff:
                            kept.append(stripped)
                        else:
                            dropped += 1
                    except (json.JSONDecodeError, ValueError):
                        dropped += 1
                with open(self._path, "w", encoding="utf-8") as fh:
                    fh.write("\n".join(kept) + ("\n" if kept else ""))
        except FileNotFoundError:
            pass
        return dropped
