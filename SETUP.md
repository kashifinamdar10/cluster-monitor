# Setup & Deployment Guide

Step-by-step instructions for getting the Databricks Compute Monitor up and running — from local development through production deployment — including required permissions and troubleshooting tips.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Local Development](#3-local-development)
4. [Configure databricks.yml for Your Workspace](#4-configure-databricksyml-for-your-workspace)
5. [Deploy to Databricks](#5-deploy-to-databricks)
6. [Post-Deployment: Grant the App SP Workspace Admin](#6-post-deployment-grant-the-app-sp-workspace-admin)
7. [Post-Deployment: Record the Lakebase Database Path](#7-post-deployment-record-the-lakebase-database-path)
8. [Optional: Encrypt Stored Secrets](#8-optional-encrypt-stored-secrets)
9. [Optional: Multi-Workspace Monitoring](#9-optional-multi-workspace-monitoring)
10. [Subsequent Deploys](#10-subsequent-deploys)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

### Tools

Install the following on your local machine before proceeding.

| Tool | Minimum Version | Notes |
|---|---|---|
| [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html) | `>= 0.294.0` | Run `databricks --version` to check |
| Python | `>= 3.11` | Run `python3 --version` to check |
| Node.js | `>= 20` | Only needed for the frontend build — not required at runtime. Run `node --version` to check. |
| npm | Bundled with Node.js | Run `npm --version` to check |

### Databricks Account & Workspace Permissions

The **person deploying the app** needs the following before starting:

- **Workspace Admin** on the target Databricks workspace — required to:
  - Deploy Databricks Apps (`databricks bundle deploy`)
  - Add the app's service principal to the `admins` group after first deploy (Step 6)
- **Databricks Apps** available on the target workspace — both Apps and Lakebase are GA and available by default on all workspaces. No manual enablement is required.
- A configured **Databricks CLI profile** pointing at the target workspace. Run `databricks auth login` if you have not done so yet.

> **Not a workspace admin?** You can still run the app locally for development (Step 3), but you will not be able to complete the full deployment until an admin grants you the permissions above.

---

## 2. Clone & Install

```bash
git clone <repo-url>
cd dbx_compute_monitor
```

### Install Python dependencies

```bash
pip install -r requirements.txt
```

### Install and build the React frontend

```bash
npm install --prefix frontend
npm run build --prefix frontend
```

The build output lands in `dist/`. This folder is committed to the repo and deployed as part of the bundle, so you only need to rebuild when you change files under `frontend/src/`.

---

## 3. Local Development

You can run the full app locally against any Databricks workspace you have access to.

### 3a. Authenticate with Databricks

```bash
databricks auth login --profile DEFAULT
```

Or export credentials directly:

```bash
export DATABRICKS_HOST=https://<your-workspace>.azuredatabricks.net
export DATABRICKS_TOKEN=dapi...
```

### 3b. Start the API server

```bash
python app.py
```

The app will be available at [http://localhost:8000](http://localhost:8000).

### 3c. (Optional) Hot-reload frontend dev server

In a second terminal:

```bash
npm run dev --prefix frontend
```

The Vite dev server starts at [http://localhost:5173](http://localhost:5173) and proxies all `/api` requests to `localhost:8000`. Changes to files under `frontend/src/` reload instantly.

### 3d. (Optional) Enable local history with Lakebase

If you have a Lakebase endpoint available, export it before starting the server:

```bash
export LAKEBASE_ENDPOINT=projects/cmon-dev/branches/production/endpoints/primary
python app.py
```

Without this, the History tab shows "Not available" — all other tabs work normally.

---

## 4. Configure databricks.yml for Your Workspace

Before deploying, update `databricks.yml` to point at your workspace.

Open `databricks.yml` and edit the `targets` section:

```yaml
targets:
  dev:
    workspace:
      host: https://<your-workspace>.azuredatabricks.net
      workspace_id: "<your-workspace-id>"
      profile: <your-cli-profile>

  prod:
    workspace:
      host: https://<your-workspace>.azuredatabricks.net
      workspace_id: "<your-workspace-id>"
      profile: <your-cli-profile>
      root_path: /Workspace/Users/<your-email>/.bundle/${bundle.name}/${bundle.target}
```

**Finding your workspace ID:**  
It is the numeric ID in your workspace URL — e.g. `https://adb-**1234567890123456**.11.azuredatabricks.net`.

**Finding your CLI profile name:**  
Run `databricks auth profiles` to list configured profiles.

> If you only want to deploy to one environment, you only need to configure the `dev` target. The `prod` target can be added later.

---

## 5. Deploy to Databricks

### 5a. Validate the bundle (recommended)

```bash
databricks bundle validate -t dev
```

Fix any errors before proceeding.

### 5b. Deploy the bundle

```bash
databricks bundle deploy -t dev
```

This does the following automatically:
- Uploads all source files and the pre-built `dist/` folder to the workspace
- Creates the **Databricks App** resource (`cluster-monitor`)
- Creates the **Lakebase project** (`cmon-dev`), its production branch, and a dev branch
- Creates the **snapshot job** (paused by default)

### 5c. Start the app

```bash
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/dev/files \
  --profile <your-cli-profile>
```

The app URL will be printed in the output. You can also find it in the Databricks UI under *Apps*.

> **First run may take 1–2 minutes** while the app container starts up and installs Python dependencies.

---

## 6. Post-Deployment: Grant the App SP Workspace Admin

This is a **required one-time step**. Without it, the app's service principal only sees compute resources it owns — not all users' clusters and warehouses.

### 6a. Find the admins group ID

```bash
databricks groups list --profile <your-profile> | python3 -c "
import sys, json
for g in json.load(sys.stdin):
    if g.get('displayName') == 'admins':
        print('admins group id:', g['id'])
"
```

### 6b. Find the app's service principal ID

```bash
databricks apps get cluster-monitor --profile <your-profile> \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('SP id:', d['service_principal_id'])"
```

### 6c. Add the SP to the admins group

```bash
databricks groups patch <ADMINS_GROUP_ID> \
  --json '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [{"op": "add", "path": "members",
      "value": [{"value": "<SP_ID>"}]}]
  }' --profile <your-profile>
```

Replace `<ADMINS_GROUP_ID>` and `<SP_ID>` with the values from steps 6a and 6b.

### 6d. Restart the app

After granting admin, restart the app so it picks up the new permissions:

```bash
databricks apps stop cluster-monitor --profile <your-profile>
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/dev/files \
  --profile <your-profile>
```

> **Why workspace admin?** On workspaces with Cluster Access Control enabled, a non-admin identity can only list compute it owns. A monitoring app needs visibility across all users — this is why admin is required.

---

## 7. Post-Deployment: Record the Lakebase Database Path

The bundle creates a Lakebase project automatically on first deploy, but the auto-generated database path must be recorded in `databricks.yml` so subsequent deploys can reference it.

### 7a. Discover the database path

```bash
databricks postgres list-databases \
  projects/cmon-dev/branches/production \
  --profile <your-profile>
```

This returns something like:
```
projects/cmon-dev/branches/production/databases/db-xxxx-yyyyyyyyyyyy
```

### 7b. Update databricks.yml

```yaml
targets:
  dev:
    variables:
      lakebase_database: "projects/cmon-dev/branches/production/databases/db-xxxx-yyyyyyyyyyyy"
```

### 7c. Redeploy to wire it up

```bash
databricks bundle deploy -t dev
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/dev/files \
  --profile <your-profile>
```

After this, the **History tab** in the app will become available and the app will begin recording state snapshots on every refresh.

> Repeat steps 7a–7c for the `prod` target (replacing `cmon-dev` with `cmon-prod`) when you deploy to production.

---

## 8. Optional: Encrypt Stored Secrets

The Settings page allows you to store service principal credentials. By default, secrets are stored in plaintext in Lakebase. To encrypt them at rest, generate a Fernet key and set it in `app.yaml`.

### Generate a key

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Store it securely (recommended)

Store the key in a Databricks secret scope and reference it in `app.yaml`:

```yaml
env:
  - name: SETTINGS_ENCRYPTION_KEY
    valueFrom: secret://your-scope/settings-encryption-key
```

### Or set it as a plain value (simpler, less ideal)

```yaml
env:
  - name: SETTINGS_ENCRYPTION_KEY
    value: "<your-generated-fernet-key>"
```

> **Important:** Generate this key once and keep it stable across deploys. Rotating the key invalidates any previously encrypted secrets stored in Lakebase — you would need to re-enter them in the Settings UI.

---

## 9. Multi-Workspace Monitoring (classic scraper)

On this branch the **App does not scrape spokes**. A classic job in the hub workspace
lists compute across workspaces and writes Lakebase; the App only reads snapshots.

This avoids Apps Private Link failures such as:

`Cert validation failed. Both workspace comparison and snp system trusted checks did not pass.`

### 9a. Create an account-level service principal

1. Go to your [Databricks Account Console](https://accounts.azuredatabricks.net)
2. Navigate to *User Management → Service Principals → Add service principal*
3. Generate an OAuth secret for the SP (*Secrets → Generate secret*). **Save the secret — it is shown only once.**
4. Note the Account ID (the UUID shown in the Account Console URL), the SP's Client ID, and the secret.

> The Account ID is the Databricks account UUID — **not** your Azure tenant ID or subscription ID.

### 9b. Grant the SP workspace admin on each target workspace

Either use the **Grant Admin** button in the app's Settings page (after entering the SP credentials), or run:

```bash
# For each target workspace:
databricks workspace-assignment update \
  --workspace-id <workspace-id> \
  --principal-id <sp-principal-id> \
  --permissions ADMIN \
  --profile <account-level-profile>
```

Also ensure the **classic job cluster** in the hub can reach each spoke API
(VNet peering / Private Link / NCC as required by your network team).

### 9c. Enter credentials in the app's Settings page

Open the app → *Settings* → *Account Service Principal*. Enter:
- Account ID
- Client ID
- Client Secret

Click *Validate* to confirm connectivity, then *Discover Workspaces* to auto-populate the workspace list.
Settings are stored in Lakebase and loaded by `snapshot_job.py` on every run.

### 9d. Confirm the classic scrape job

1. Jobs → `cluster-monitor-snapshot` → Run now (or click **Refresh All** in the App).
2. Job logs should show per-workspace cluster/warehouse counts with **no** cert-validation errors.
3. App tables populate from `GET /api/snapshot/latest`.

> Prefer **one central classic scraper** when the hub already has network access to spokes.
> Deploy per-workspace collector jobs only if hub→spoke API calls still fail from classic compute.

---

## 10. Subsequent Deploys

After the initial setup is complete, use this flow for all future deploys:

```bash
# Rebuild frontend only if you changed files under frontend/src/
npm run build --prefix frontend

# Validate (optional but recommended)
databricks bundle validate -t dev

# Deploy bundle + app
databricks bundle deploy -t dev && \
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/dev/files \
  --profile <your-profile>
```

For production:

```bash
npm run build --prefix frontend
databricks bundle deploy -t prod && \
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/prod/files \
  --profile <your-profile>
```

---

## 11. Troubleshooting

### Tables are empty or only show resources owned by the app SP

**Cause:** The app's service principal has not been added to the `admins` group.

**Fix:** Complete [Step 6](#6-post-deployment-grant-the-app-sp-workspace-admin), then restart the app.

---

### History tab shows "Not available"

**Cause:** Either the Lakebase database path has not been recorded in `databricks.yml`, or the Lakebase endpoint is not connected.

**Fix:**
1. Confirm you completed [Step 7](#7-post-deployment-record-the-lakebase-database-path).
2. Check the app health endpoint: `https://<your-app-url>/api/health` — look at the `history` and `lakebase_project_id` fields.
3. If `lakebase_project_id` is empty, the `LAKEBASE_ENDPOINT` env var is not set — redeploy the bundle with a valid `lakebase_database` variable.

---

### Settings won't save — "Failed to save settings to file"

**Cause:** The Databricks Apps filesystem is read-only. Settings are intended to be persisted in Lakebase. This error means Lakebase is not connected.

**Fix:** Ensure the Lakebase database path is recorded (Step 7) and the app is redeployed. Settings will then persist to Lakebase automatically.

---

### SP validation fails with "invalid_client"

**Cause:** One or more of the following:
- The **Account ID** is your Azure tenant or subscription ID — it must be the Databricks account UUID shown at `accounts.azuredatabricks.net`
- The **SP is workspace-level only**, not account-level — it must be created in the Account Console
- The **secret is a Personal Access Token (PAT)** — it must be an OAuth client secret generated under *Account Console → Service Principals → [SP] → Secrets → Generate secret*

**Fix:** Verify all three items above. Re-enter the correct credentials in Settings.

---

### SP validation fails with "PERMISSION_DENIED"

**Cause:** The SP authenticated successfully but lacks Account Admin or *Can View* permission on the account.

**Fix:** In the Account Console, go to *User Management → Service Principals → [SP]* and assign the **Account Admin** role, or at minimum **Can View** if you only need workspace discovery.

---

### Frontend shows a blank page

**Cause:** The `dist/` folder is missing or the React build failed.

**Fix:**

```bash
npm run build --prefix frontend
```

If the build fails, check for Node.js version issues (`node --version` should be `>= 20`).

---

### `databricks bundle validate` fails with "workspace not found" or auth errors

**Cause:** The `host`, `workspace_id`, or `profile` in `databricks.yml` does not match your environment.

**Fix:**
1. Run `databricks auth profiles` to list your configured profiles and their hosts.
2. Update `databricks.yml` to match (see [Step 4](#4-configure-databricksyml-for-your-workspace)).
3. Run `databricks auth login --profile <your-profile>` if the profile is expired or misconfigured.

---

### App shows a "dev environment" banner in production

**Cause:** `BUNDLE_TARGET` is set to `dev` instead of `prod`, or the app was deployed with the `dev` bundle target.

**Fix:** Deploy using `-t prod`:

```bash
databricks bundle deploy -t prod
databricks apps deploy cluster-monitor \
  --source-code-path /Workspace/Users/<your-email>/.bundle/cluster_monitor/prod/files \
  --profile <your-profile>
```

---

### Multi-workspace: Cert validation failed / empty spoke data

**Cause:** The App (or serverless path) cannot reach spoke workspaces under Private Link /
egress policy. Or the classic job still lacks network / admin on those spokes.

**Fix:**
1. Confirm scrapes run from **classic** `cluster-monitor-snapshot`, not from the App SSE path
   (SSE is disabled / returns 410 on this branch).
2. Fix hub classic → spoke API connectivity (peering / NCC / allowed domains).
3. In Settings, *Check Permissions* / *Grant Admin* for the account SP on each spoke.
4. Re-run the job and verify Lakebase `scrape_runs.status = completed`.

---

### Viewing app logs

```bash
databricks apps logs cluster-monitor --profile <your-profile>
```

Add `--follow` to stream logs in real time.

---

### Checking app health

The `/api/health` endpoint returns the current status of the app and its backend:

```bash
curl https://<your-app-url>/api/health
```

Example response:

```json
{
  "status": "ok",
  "history": true,
  "backend": "lakebase",
  "bundle_target": "dev",
  "workspace_host": "https://adb-xxxx.azuredatabricks.net",
  "lakebase_project_id": "cmon-dev"
}
```

If `history` is `false`, the Lakebase backend is not connected. If `lakebase_project_id` is empty, the `LAKEBASE_ENDPOINT` env var is missing — redeploy the bundle with a valid `lakebase_database` variable.
