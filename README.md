# Databricks Compute Monitor (classic-scraper / read-only App)

A compute monitoring dashboard for Databricks interactive clusters, job clusters,
SQL warehouses, DLT pipelines, and active job runs — deployed as a
[Databricks App](https://docs.databricks.com/en/dev-tools/databricks-apps/index.html)
with a **classic-compute scrape job** as the sole multi-workspace writer.

Built with **FastAPI + React (Vite + Tailwind CSS)** and managed as a
**Declarative Automation Bundle (DAB)**.

---

## Why classic scrape + read-only App?

Databricks Apps often fail when calling **other workspaces** under Private Link /
restricted egress with:

```text
Cert validation failed. Both workspace comparison and snp system trusted checks did not pass.
```

This branch fixes that for hub/spoke estates:

1. **Classic single-node job** (`cluster-monitor-snapshot` on `Standard_DS3_v2`)
   scrapes all configured workspaces using the account SP (approved VNet path).
2. Snapshots land in **Lakebase** (`scrape_runs` + `resource_snapshots`).
3. The **App UI is Lakebase-read-only** — no cross-workspace SDK fan-out from Apps.

**Central classic scraper is preferred** over one collector job per workspace when
the hub already has approved connectivity: one schedule, one SP config, one Lakebase.
Use per-workspace collectors only if hub classic still cannot reach spoke APIs.

```
Spoke workspaces ──SDK list APIs──► Classic scrape job (hub)
                                         │
                                         ▼
                                      Lakebase
                                         │
                                         ▼
                                   Read-only App UI
```

---

## Features

- Snapshot view of clusters, warehouses, DLT pipelines, and active job runs across workspaces
- **Needs Attention** tab — cross-resource error aggregation with doc links
- Filters: tag key/value, workspace, state
- Auto-refresh (reload Lakebase) + **Refresh All** (trigger classic job + poll)
- History tab: state transitions and uptime % from Lakebase
- Settings UI configures workspaces + account SP for the **job** (not App scrape)
- Dark mode, activity log, About page

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Hub workspace                                           │
│                                                          │
│  Job: cluster-monitor-snapshot  (classic Standard_DS3_v2)│
│    snapshot_job.py                                       │
│      load app_settings from Lakebase                     │
│      WorkspaceClient per enabled workspace               │
│      store_snapshot(..., scrape_run_id)                  │
│                                                          │
│  Lakebase  cluster_monitor.scrape_runs                   │
│            cluster_monitor.resource_snapshots            │
│            cluster_monitor.app_settings                  │
│                                                          │
│  App: cluster-monitor  (read-only)                       │
│    GET  /api/snapshot/latest                             │
│    POST /api/snapshot/trigger  → jobs.run_now(...)       │
│    GET  /api/history                                     │
│    GET  /api/workspaces / settings / health              │
└──────────────────────────────────────────────────────────┘
```

---

## Customer test plan (hub workspace)

1. Deploy bundle + app to the **central** Azure workspace (classic job + Lakebase + App).
2. Grant the **job** identity (run-as user / job SP) workspace admin on every spoke
   it must scrape, and Lakebase connect on the hub.
3. In the App → **Settings** → Account Service Principal → Validate → Discover Workspaces
   → enable targets → Save.
4. Run **cluster-monitor-snapshot** once (or click **Refresh All**). Confirm the job
   succeeds with no cert-validation errors.
5. Open the App — tables should fill from Lakebase. Auto-refresh only reloads snapshots;
   Refresh All re-triggers the classic job.

Pause the schedule anytime: Jobs UI → `cluster-monitor-snapshot` → Pause, or set
`pause_status: PAUSED` in `resources/snapshot_job.yml` and redeploy.

---

## Project Structure

```
cluster-monitor/
├── api/
│   ├── compute.py        # SDK fetchers used by the classic job
│   ├── main.py           # FastAPI — read-only snapshot API + settings
│   └── settings.py
├── frontend/             # React SPA (polls /api/snapshot/latest)
├── resources/
│   ├── cluster_monitor.app.yml
│   ├── cluster_monitor_lakebase.yml
│   └── snapshot_job.yml  # classic scrape job (UNPAUSED by default)
├── snapshot_job.py       # sole multi-workspace writer
├── backend.py            # Lakebase + scrape_runs
├── app.py / app.yaml
└── databricks.yml
```

---

## Local Development

```bash
pip install -r requirements.txt
npm install --prefix frontend && npm run build --prefix frontend
databricks auth login --profile <PROFILE>
export LAKEBASE_ENDPOINT=projects/cmon-dev/branches/production/endpoints/primary
python app.py
```

Hot-reload UI: `npm run dev --prefix frontend` (proxies `/api` → `:8000`).

---

## Deployment

```bash
npm run build --prefix frontend
databricks bundle validate -t dev
databricks bundle deploy -t dev
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<you>/.bundle/cluster_monitor/dev/files \
  --profile <PROFILE>
```

Post-deploy:

1. Record Lakebase database path in `databricks.yml` (`lakebase_database`) after first create.
2. Grant App SP Lakebase access (via app resource) — **not** required for spoke listing.
3. Ensure classic job can reach spoke workspace APIs (VNet / Private Link / peering).

See **[SETUP.md](SETUP.md)** for full steps.

---

## Multi-workspace configuration

Configure via App **Settings** (stored in Lakebase `app_settings`). The classic job
loads that blob on every run. Legacy `WORKSPACE_CONFIGS` env JSON still works as fallback.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABRICKS_HOST` / `TOKEN` | Auto (Apps) | Hub workspace auth for the App |
| `LAKEBASE_ENDPOINT` | Yes (Apps) | Injected via `valueFrom: postgres` |
| `BUNDLE_TARGET` | DABs | `dev` / `prod` banner |
| `SNAPSHOT_JOB_NAME` | Optional | Default `cluster-monitor-snapshot` |
| `SNAPSHOT_JOB_ID` | Optional | Explicit job id for trigger |
| `WORKSPACE_CONFIGS` | Optional | Legacy JSON workspace list |

---

## Branch note

`feature/classic-compute-central-scraper` implements the hub classic-scraper architecture
above. Baseline v1.1 live SSE scrape from the App is on `main` for comparison.
