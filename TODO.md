# TODO

Items roughly ordered by priority. Move to GitHub Issues when the project grows.

---

## High Priority

- [ ] **Lakebase history wiring** — set `LAKEBASE_INSTANCE_NAME` in the dev environment and verify the History tab end-to-end (state changes + uptime chart)
- [ ] **Background snapshot job** — create a Lakeflow Job (or scheduled notebook) that calls `LakebaseBackend.store_snapshot()` on a cron to populate history data
- [ ] **Add a `prod` DAB target** — duplicate the `dev` block in `databricks.yml` with the production workspace host/ID
- [ ] **Remove `app_dash.py`** — once the FastAPI + React app is confirmed stable in production, delete the archived Dash file

## Features

- [ ] **Cluster detail drawer** — click a cluster row to open a side panel showing full config (init scripts, libraries, autoscale settings, tags)
- [ ] **Terminate / restart action** — add a "Terminate" button (with confirmation) for running clusters using the SDK `clusters.delete()` call
- [ ] **Warehouse start / stop** — similar quick-action buttons for SQL warehouses
- [ ] **Cost estimate column** — multiply running time (from Lakebase history) × DBU rate to show estimated spend per resource
- [ ] **Search / free-text filter** — add a global search input that filters by cluster name, creator, or tag value across all tabs
- [ ] **Export to CSV** — download the current filtered view as a CSV file
- [ ] **Dark mode** — respect `prefers-color-scheme` using Tailwind's `dark:` variant

## History & Analytics

- [ ] **Uptime sparkline** — add a mini bar chart to the uptime table rows showing % per day over the past week
- [ ] **State change alerts** — push a notification (Slack webhook or email) when a cluster transitions to ERROR state
- [ ] **Retention setting** — expose a UI control for the history window (currently hardcoded to 24h/72h in the dropdown)

## Infrastructure

- [ ] **Bundle `prod` target + CI deploy** — add a GitHub Actions workflow that runs `bundle deploy -t prod` on merge to `main`
- [ ] **Lakebase resource in bundle** — once the instance name is known, re-enable the `lakebase-instance` resource in `resources/cluster_monitor.app.yml` and update `app.yaml` to use `valueFrom:`
- [ ] **Multi-workspace configs as a secret** — move `WORKSPACE_CONFIGS` from a plain env var to a Databricks secret scope so tokens are not stored in `app.yaml`
- [ ] **Health check endpoint monitoring** — set up an external ping to `/api/health` and alert if the app goes down

## Technical Debt

- [ ] **SSE reconnect logic** — the `EventSource` in `useComputeData.ts` will silently retry on disconnect; add a max-retry counter and a visible "reconnecting…" banner
- [ ] **Error boundary** — wrap the React tree in an `<ErrorBoundary>` so a component crash doesn't blank the entire page
- [ ] **Unit tests** — add pytest tests for `api/compute.py` (mock the SDK) and Vitest tests for the React hooks/components
- [ ] **Typed API contract** — generate TypeScript types from the FastAPI OpenAPI schema (`/api/docs`) to keep frontend types in sync automatically
- [ ] **Page-size tuning** — expose `_PAGE_SIZE_HINT` in `compute.py` as an env var so it can be tuned without a code change
