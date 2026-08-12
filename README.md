# Databricks Compute Monitor

A real-time compute monitoring dashboard for Databricks interactive clusters, job clusters, SQL warehouses, DLT pipelines, and active job runs — deployed as a [Databricks App](https://docs.databricks.com/en/dev-tools/databricks-apps/index.html).

Built with **FastAPI + React (Vite + Tailwind CSS)** and managed as a **Declarative Automation Bundle (DAB)**.

---

## Features

- Live view of interactive clusters, job clusters, SQL warehouses, DLT pipelines, and active job runs across one or more workspaces
- **Needs Attention** tab — cross-resource error aggregation with links to relevant Databricks documentation
- State badges with color coding (running, pending, terminated, error, …)
- Filters: tag key/value, workspace, state
- Tag breakdown table: resource counts grouped by tag
- Auto-refresh (30 s / 1 min / 2 min / 5 min / off) with streaming page-by-page feedback via Server-Sent Events
- Per-resource refresh buttons with last-refreshed tooltips
- Floating activity log (bottom-right) with open/close state persisted in `localStorage`
- Optional history tab: state transitions and uptime % powered by a [Lakebase](https://docs.databricks.com/en/database/index.html) (Postgres) backend
- Dark mode with localStorage persistence (no flash on reload)
- Dev environment banner shown automatically in non-production deployments
- About page with app architecture, data flow, tech stack, changelog, and workspace deep-links

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Databricks App  (cluster-monitor)          │
│                                             │
│  app.py  ─── builds dist/ if missing       │
│           └── starts uvicorn on             │
│               0.0.0.0:$DATABRICKS_APP_PORT  │
│                                             │
│  api/main.py  (FastAPI)                     │
│    GET /api/compute/stream  ← SSE           │
│    GET /api/snapshot/latest                 │
│    GET /api/history?hours=N                 │
│    GET /api/workspaces                      │
│    GET /api/health                          │
│    GET /*          ← serves dist/index.html │
│                                             │
│  api/compute.py   Databricks SDK calls      │
│  backend.py       Lakebase (psycopg)        │
│                                             │
│  dist/  ← pre-built React SPA              │
└─────────────────────────────────────────────┘
```

The React frontend is pre-built locally and synced to the workspace via `databricks bundle deploy`. FastAPI serves both the API and the static `dist/` folder from a single process (no CORS complications).

Data streams from the backend via **Server-Sent Events** (`/api/compute/stream`). The SDK's paginated iterators flush a page to the browser every ~20 items so tables populate incrementally.

---

## Project Structure

```
dbx_compute_monitor/
├── api/
│   ├── __init__.py
│   ├── compute.py        # SDK cluster/warehouse/pipeline/job-run fetchers + SSE worker
│   └── main.py           # FastAPI app — all /api/* routes
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Root component, routing, header, dark mode
│   │   ├── types.ts
│   │   ├── index.css             # Tailwind + global dark-mode overrides
│   │   ├── hooks/
│   │   │   ├── useComputeData.ts # EventSource hook + per-resource refresh
│   │   │   ├── useDarkMode.ts    # Dark mode state + localStorage persistence
│   │   │   └── useTableFeatures.ts # Column sort, resize, pagination
│   │   └── components/
│   │       ├── AboutPage.tsx       # Architecture, changelog, deep-links
│   │       ├── ActivityLog.tsx     # Floating activity log panel
│   │       ├── ClusterTable.tsx
│   │       ├── FilterBar.tsx
│   │       ├── HistoryTab.tsx
│   │       ├── JobRunsTable.tsx
│   │       ├── NeedsAttentionTab.tsx  # Cross-resource error aggregation
│   │       ├── PipelineTable.tsx
│   │       ├── SettingsPage.tsx
│   │       ├── StateBadge.tsx
│   │       ├── SummaryCards.tsx
│   │       ├── TagBreakdown.tsx
│   │       └── WarehouseTable.tsx
│   ├── package.json
│   ├── vite.config.ts    # builds to ../dist
│   └── tailwind.config.js
├── resources/
│   ├── cluster_monitor.app.yml        # DABs App resource
│   ├── cluster_monitor_lakebase.yml   # DABs Lakebase project + dev branch
│   └── snapshot_job.yml               # DABs Job resource (paused by default)
├── dist/                 # pre-built React SPA (committed, synced by bundle deploy)
├── app.py                # entry point: build-if-missing + uvicorn
├── app.yaml              # Databricks App runtime manifest
├── backend.py            # Lakebase connection + schema + queries
├── databricks.yml        # DABs bundle config (targets: dev, prod)
└── requirements.txt
```

---

## Prerequisites

- [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html) `>= 0.294.0`
- Python `>= 3.11`
- Node.js `>= 20` (for frontend builds only — not needed at runtime)
- A configured Databricks CLI profile (see `databricks auth login`)

> For a full step-by-step setup guide — including required permissions, first-time deployment, post-deploy configuration, and troubleshooting — see **[SETUP.md](SETUP.md)**.

---

## Local Development

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install & build the frontend

```bash
npm install --prefix frontend
npm run build --prefix frontend
```

> Re-run `npm run build --prefix frontend` after any changes to `frontend/src/`.
> For hot-reload development, run `npm run dev --prefix frontend` (proxies `/api` to `localhost:8000`).

### 3. Run the API server

```bash
databricks auth login --profile DEFAULT   # or set DATABRICKS_HOST + DATABRICKS_TOKEN
python app.py
```

The app will be available at [http://localhost:8000](http://localhost:8000).

### 4. (Optional) Enable history with Lakebase

Set `LAKEBASE_ENDPOINT` in `app.yaml` (or use the **Settings** page in the deployed app)
to point at an autoscaling Lakebase endpoint. See the [Post-deployment Tasks](#post-deployment-tasks)
section for setup instructions.

For local dev you can point directly at the Lakebase endpoint:

```bash
export LAKEBASE_ENDPOINT=projects/cmon-dev/branches/production/endpoints/primary
python app.py
```

---

## Deployment

### First-time deploy

```bash
# 1. Authenticate (if not already done)
databricks auth login --profile <PROFILE>

# 2. Build the React frontend
npm run build --prefix frontend

# 3. Deploy the bundle (uploads source + dist/, creates app + snapshot job)
databricks bundle deploy -t dev

# 4. Deploy the app code
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<you>/.bundle/cluster_monitor/dev/files \
  --profile <PROFILE>
```

### Subsequent deploys

```bash
# Rebuild frontend if you changed any frontend source
npm run build --prefix frontend

# Validate (optional but recommended)
databricks bundle validate -t dev

# Deploy bundle + app in one go
databricks bundle deploy -t dev && \
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<you>/.bundle/cluster_monitor/dev/files \
  --profile <PROFILE>
```

---

## Post-deployment Tasks

These one-time steps are required after the first deploy to a new workspace.

### 1. Grant the app SP workspace admin

The app's service principal (SP) must be a workspace admin to call
`clusters.list()`, `warehouses.list()`, and other monitoring APIs on behalf of
all users. Without it the SP only sees resources it owns.

```bash
# Find the workspace admins group ID
databricks groups list --profile <PROFILE> | python3 -c "
import sys, json
for g in json.load(sys.stdin):
    if g.get('displayName') == 'admins':
        print('admins group id:', g['id'])
"

# Find the app SP ID
databricks apps get cluster-monitor --profile <PROFILE> \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('SP id:', d['service_principal_id'])"

# Add the SP to the admins group
databricks groups patch <ADMINS_GROUP_ID> \
  --json '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [{"op": "add", "path": "members",
      "value": [{"value": "<SP_ID>"}]}]
  }' --profile <PROFILE>
```

> **Why admin?** On workspaces with Cluster Access Control enabled, non-admin
> identities can only list compute resources they own. A monitoring app needs
> visibility across all users' clusters and warehouses.

### 2. Lakebase setup

The Lakebase project, dev branch, and database are **fully managed by DABs** — `databricks bundle deploy` creates them automatically. No manual CLI setup is required.

After the first `dev` deploy, find the auto-generated database resource path and record it in `databricks.yml` under `targets.dev.variables.lakebase_database`:

```bash
databricks postgres list-databases \
  projects/cmon-dev/branches/production --profile <PROFILE>
# Returns something like: projects/cmon-dev/branches/production/databases/db-xxxx-yyyyyyyy
```

Update `databricks.yml`:

```yaml
targets:
  dev:
    variables:
      lakebase_database: "projects/cmon-dev/branches/production/databases/db-xxxx-yyyyyyyy"
```

Then redeploy: `databricks bundle deploy -t dev`.

Do the same for `prod` (replacing `cmon-dev` with `cmon-prod`).

### 3. View logs

```bash
databricks apps logs cluster-monitor --profile <PROFILE>
```

---

## Multi-workspace Monitoring

Set the `WORKSPACE_CONFIGS` environment variable (JSON array) in `app.yaml` or via the Databricks Apps UI:

```json
[
  {"name": "prod", "host": "https://prod.azuredatabricks.net", "token": "dapiXXX"},
  {"name": "dev",  "host": "https://dev.azuredatabricks.net",  "client_id": "...", "client_secret": "..."}
]
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABRICKS_HOST` | Auto-injected | Workspace host (injected by Apps runtime) |
| `DATABRICKS_TOKEN` | Auto-injected | Auth token (injected by Apps runtime) |
| `DATABRICKS_APP_PORT` | Auto-injected | HTTP port (injected by Apps runtime) |
| `BUNDLE_TARGET` | Set by DABs | Deployment target name (`dev` / `prod`) — drives the dev banner and `/api/health` response |
| `LAKEBASE_ENDPOINT` | Set by DABs | Autoscaling Lakebase endpoint resource name — injected automatically from the `postgres` app resource |
| `LAKEBASE_DATABASE_NAME` | Optional | Postgres database name (default: `databricks_postgres`) |
| `LAKEBASE_PG_URL` | Optional | Static Postgres connection URL for local dev (bypasses SDK auth) |
| `SNAPSHOT_FILE_PATH` | Optional | Volume path for JSON-file history fallback (e.g. `/Volumes/cat/schema/vol/`) |
| `WORKSPACE_CONFIGS` | Optional | JSON array of workspace configs for multi-workspace mode |

---

## Bundle Targets

| Target | Workspace | Profile | Notes |
|---|---|---|---|
| `dev` (default) | `adb-3180815342576841` (Azure) | `adb-terraform` | `mode: development` — resource names prefixed with `[dev <username>]` |
| `prod` | `adb-3180815342576841` (Azure) | `adb-terraform` | `mode: production` — canonical resource names, explicit root path |

Both targets deploy to the same workspace; environment isolation comes from separate DABs-managed Lakebase projects (`cmon-dev` / `cmon-prod`) and the `mode:` setting.

To add a new target, copy a target block in `databricks.yml`, update `workspace.host`, `workspace_id`, and `profile`, then deploy once to let DABs create the new Lakebase project.
