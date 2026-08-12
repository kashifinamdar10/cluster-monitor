const VERSION = '1.2.0'

const CHANGELOG: { version: string; date: string; changes: string[] }[] = [
  {
    version: '1.2.0',
    date: 'August 2026',
    changes: [
      'Classic-compute central scraper: job is the sole multi-workspace writer',
      'App UI is Lakebase-read-only — avoids Apps Private Link "Cert validation failed"',
      'Refresh All triggers cluster-monitor-snapshot job and polls for new scrape_run_id',
      'scrape_runs table tracks coherent snapshot cycles for the UI',
      'Job loads workspace list + account SP from Lakebase app_settings',
    ],
  },
  {
    version: '1.1.0',
    date: 'May 2026',
    changes: [
      'Add DLT Pipelines tab and Active Job Runs tab',
      'Add Needs Attention tab with cross-resource error aggregation and doc links',
      'Add About page with architecture diagram, data flow, tech stack, and changelog',
      'Add workspace deep-links on About page for deployed App and Lakebase resources',
      'Add dark mode with localStorage persistence and FOUC prevention',
      'Add dev environment banner shown when running in non-production targets',
      'Relocate Refresh All, Settings, and About controls into the header',
      'Add display preferences section with dark mode toggle in Settings',
      'Add Lakebase DABs-managed branching — dev and prod projects fully declarative',
      'Add prod deployment target in databricks.yml sharing the same workspace',
      'Add BUNDLE_TARGET env var so the frontend knows its deployment environment',
      'Expose workspace_host and lakebase_project_id from /api/health for deep-links',
      'Add snapshot job resource (paused by default) for periodic compute capture',
      'Clean up Settings page — remove volume storage and manual permission instructions',
    ],
  },
  {
    version: '1.0.0',
    date: 'May 2026',
    changes: [
      'Initial release on Databricks Apps platform',
      'Multi-workspace cluster, warehouse, pipeline and job run monitoring',
      'Server-Sent Events (SSE) streaming for real-time page-by-page feedback',
      'Lakebase (PostgreSQL) history persistence with OAuth token rotation',
      'JSON-file fallback persistence via Databricks Volumes',
      'Snapshot-on-load: tables seed from last stored state on app start',
      'Needs Attention tab with cross-resource error aggregation and doc links',
      'Hash-based tab routing for direct/bookmarkable links',
      'Per-resource deep links to Databricks workspace UI',
      'Column sorting and resizing on all tables',
      'Auto-refresh with configurable interval (30s – 5min), persisted in localStorage',
      'Refresh tooltips showing last-run time per resource type',
      'Cluster termination reason column with 39 mapped error codes',
      'Warehouse type disambiguation (Serverless vs Pro vs Classic) on Azure',
      'Tag breakdown analytics tab',
    ],
  },
]

interface StackItem { name: string; role: string; href: string }

const STACK: { layer: string; items: StackItem[] }[] = [
  {
    layer: 'Platform',
    items: [
      { name: 'Databricks Apps',        role: 'Managed app hosting with service-principal auth',          href: 'https://docs.databricks.com/en/dev-tools/databricks-apps/index.html' },
      { name: 'Lakebase (PostgreSQL)',   role: 'Autoscaling managed Postgres for snapshot history',        href: 'https://docs.databricks.com/en/database/lakebase.html' },
      { name: 'Databricks Volumes',      role: 'Optional JSON-file persistence via Unity Catalog volumes', href: 'https://docs.databricks.com/en/connect/unity-catalog/volumes.html' },
      { name: 'DABs (bundle deploy)',    role: 'Declarative resource deployment via databricks.yml',       href: 'https://docs.databricks.com/en/dev-tools/bundles/index.html' },
    ],
  },
  {
    layer: 'Backend',
    items: [
      { name: 'FastAPI',          role: 'REST API — Lakebase-read-only snapshot endpoints', href: 'https://fastapi.tiangolo.com' },
      { name: 'Databricks SDK',   role: 'Used by classic scrape job (clusters, warehouses, pipelines, jobs)', href: 'https://databricks-sdk-py.readthedocs.io' },
      { name: 'psycopg 3',        role: 'PostgreSQL driver for Lakebase connections',       href: 'https://www.psycopg.org/psycopg3/' },
      { name: 'Uvicorn',          role: 'ASGI server — entry point via app.py',             href: 'https://www.uvicorn.org' },
    ],
  },
  {
    layer: 'Frontend',
    items: [
      { name: 'React 18',         role: 'UI component library',                            href: 'https://react.dev' },
      { name: 'TypeScript',       role: 'Static typing across all components and hooks',   href: 'https://www.typescriptlang.org' },
      { name: 'Vite',             role: 'Build tool — outputs to /dist, served by FastAPI', href: 'https://vitejs.dev' },
      { name: 'Tailwind CSS',     role: 'Utility-first styling',                           href: 'https://tailwindcss.com' },
    ],
  },
]

const FLOW_STEPS = [
  {
    step: '1',
    title: 'Classic scrape job',
    detail: 'A classic single-node job (cluster-monitor-snapshot) runs every 5 minutes on approved VNet / Private Link connectivity. It loads workspace + SP config from Lakebase app_settings and lists compute across all enabled workspaces.',
  },
  {
    step: '2',
    title: 'Write to Lakebase',
    detail: 'Each cycle gets a scrape_run_id. Resource rows are appended to resource_snapshots and the scrape_runs table is marked completed. The App never writes compute snapshots.',
  },
  {
    step: '3',
    title: 'Read-only App UI',
    detail: 'On load (and auto-refresh) the frontend calls GET /api/snapshot/latest. Tables render the latest completed scrape. No cross-workspace SDK calls run inside the App — avoiding Apps egress / cert-validation failures.',
  },
  {
    step: '4',
    title: 'Manual Refresh',
    detail: 'Refresh All calls POST /api/snapshot/trigger to start the classic job, then polls /api/snapshot/latest until scrape_run_id advances (or times out and reloads the latest available snapshot).',
  },
  {
    step: '5',
    title: 'History & analytics',
    detail: 'The History tab queries Lakebase for state transitions over the last N hours using a LAG() window function — showing when each resource changed state. The uptime table shows the percentage of snapshots where each resource was RUNNING.',
  },
  {
    step: '6',
    title: 'Needs Attention',
    detail: 'On every snapshot load the frontend evaluates all resources against attention predicates (error states, SERVICE_FAULT / CLIENT_ERROR termination types, FAILED pipelines, failed job runs).',
  },
]

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5"
    >
      {children}
      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
        <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  )
}

interface AboutPageProps {
  workspaceHost?:      string
  lakebaseProjectId?:  string
}

export function AboutPage({ workspaceHost, lakebaseProjectId }: AboutPageProps) {
  // Build deep-link URLs when the workspace host is known
  const appUrl      = workspaceHost ? `${workspaceHost}/apps/cluster-monitor` : ''
  const lakebaseUrl = workspaceHost && lakebaseProjectId
    ? `${workspaceHost}/explore/data-engineering/lakebase?project=${lakebaseProjectId}`
    : workspaceHost ? `${workspaceHost}/explore/data-engineering/lakebase` : ''

  return (
    <div className="max-w-3xl space-y-10 py-2">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">
            Databricks Compute Monitor
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Classic-job snapshots of clusters, warehouses, pipelines, and job runs across
            one or more Databricks workspaces — App UI is Lakebase-read-only (Private Link safe).
          </p>
        </div>
        <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
          v{VERSION}
        </span>
      </div>

      {/* Architecture diagram (text-based flow) */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-1.5">
          Architecture
        </h2>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 font-mono text-xs text-gray-600 leading-relaxed overflow-x-auto">
          <pre>{`
  Browser (React SPA)
  ├── Hash-based tab router (#attention, #clusters, …)
  ├── useComputeData hook
  │     ├── GET  /api/snapshot/latest   ──► load tables from Lakebase
  │     ├── POST /api/snapshot/trigger  ──► start classic scrape job
  │     └── GET  /api/workspaces        ──► resolve workspace → host URL
  └── NeedsAttentionTab  ──► cross-resource error aggregation

  FastAPI App  (api/main.py) — READ-ONLY for compute
  ├── GET  /api/snapshot/latest  ──► LakebaseBackend.get_latest_snapshot()
  ├── POST /api/snapshot/trigger ──► jobs.run_now(cluster-monitor-snapshot)
  ├── GET  /api/history          ──► LAG() window query on resource_snapshots
  ├── PUT  /api/settings         ──► workspace list + account SP (for the job)
  └── GET  /api/workspaces

  Classic scrape job  (snapshot_job.py on Standard_DS3_v2)
  ├── load app_settings from Lakebase
  ├── WorkspaceClient per enabled workspace (account SP)
  │     ├── clusters.list() / warehouses.list()
  │     ├── pipelines.list_pipelines() / jobs.list_runs(active_only)
  └── store_snapshot(..., run_id) + scrape_runs table

  Lakebase (PostgreSQL)
  └── cluster_monitor schema
        ├── scrape_runs
        ├── resource_snapshots (+ scrape_run_id)
        └── app_settings
`.trim()}</pre>
        </div>
      </section>

      {/* Data flow */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-1.5">
          Data Flow
        </h2>
        <div className="space-y-3">
          {FLOW_STEPS.map(s => (
            <div key={s.step} className="flex gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-dbx-red text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {s.step}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">{s.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-1.5">
          Technology Stack
        </h2>
        <div className="space-y-5">
          {STACK.map(group => (
            <div key={group.layer}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {group.layer}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.items.map(item => (
                  <div key={item.name} className="rounded-lg border border-gray-100 bg-white p-3 flex flex-col gap-0.5">
                    <ExternalLink href={item.href}>
                      <span className="font-medium text-sm">{item.name}</span>
                    </ExternalLink>
                    <p className="text-xs text-gray-400">{item.role}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Changelog */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-1.5">
          Changelog
        </h2>
        <div className="space-y-4">
          {CHANGELOG.map(release => (
            <div key={release.version}>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                  v{release.version}
                </span>
                <span className="text-xs text-gray-400">{release.date}</span>
              </div>
              <ul className="space-y-1">
                {release.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Deployed Resources */}
      {(appUrl || lakebaseUrl) && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-1.5">
            Deployed Resources
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {appUrl && (
              <a
                href={appUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 p-4 hover:border-blue-300 hover:shadow-sm transition group"
              >
                <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4M15 3h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition">
                    Databricks App
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">cluster-monitor</p>
                </div>
                <svg className="ml-auto w-4 h-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-0.5 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
            )}
            {lakebaseUrl && (
              <a
                href={lakebaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 p-4 hover:border-blue-300 hover:shadow-sm transition group"
              >
                <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 11h6M9 15h4" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition">
                    Lakebase Project
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{lakebaseProjectId || 'Postgres backing store'}</p>
                </div>
                <svg className="ml-auto w-4 h-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-0.5 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
            )}
          </div>
        </section>
      )}

      {/* Links */}
      <section className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Service Status</p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://status.databricks.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm transition group"
            >
              <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Live status indicator" />
              Databricks Status
              <svg className="w-3 h-3 text-gray-300 group-hover:text-blue-500 transition" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="https://azure.status.microsoft/en-us/status"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm transition group"
            >
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              Azure Service Status
              <svg className="w-3 h-3 text-gray-300 group-hover:text-blue-500 transition" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Documentation</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <ExternalLink href="https://docs.databricks.com/en/dev-tools/databricks-apps/index.html">
              Databricks Apps docs
            </ExternalLink>
            <ExternalLink href="https://docs.databricks.com/en/dev-tools/bundles/index.html">
              DABs reference
            </ExternalLink>
            <ExternalLink href="https://docs.databricks.com/en/database/lakebase.html">
              Lakebase docs
            </ExternalLink>
            <ExternalLink href="https://databricks-sdk-py.readthedocs.io">
              Python SDK reference
            </ExternalLink>
            <ExternalLink href="https://docs.databricks.com/en/error-messages/cluster-termination-reasons.html">
              Cluster termination reasons
            </ExternalLink>
          </div>
        </div>
      </section>

    </div>
  )
}
