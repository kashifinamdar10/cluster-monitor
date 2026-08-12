import type { Cluster, Warehouse, Pipeline, JobRun } from '../types'
import { StateBadge } from './StateBadge'
import { clusterUrl, warehouseUrl, pipelineUrl, jobRunUrl, workspaceUrl } from '../utils/workspaceLinks'

// ── Per-type attention predicates ────────────────────────────────────────────

export function clusterNeedsAttention(c: Cluster): boolean {
  return (
    c.state === 'ERROR' ||
    c.termination_type === 'CLIENT_ERROR' ||
    c.termination_type === 'SERVICE_FAULT'
  )
}

export function warehouseNeedsAttention(w: Warehouse): boolean {
  return w.state === 'DEGRADED' || w.state === 'ERROR'
}

export function pipelineNeedsAttention(p: Pipeline): boolean {
  return p.state === 'FAILED'
}

export function jobRunNeedsAttention(r: JobRun): boolean {
  return (
    r.state === 'INTERNAL_ERROR' ||
    r.result_state === 'FAILED' ||
    r.result_state === 'TIMEDOUT' ||
    r.result_state === 'UPSTREAM_FAILED'
  )
}

/** Total count of all resources needing attention — used for the tab badge. */
export function attentionCount(
  clusters: Cluster[],
  warehouses: Warehouse[],
  pipelines: Pipeline[],
  jobRuns: JobRun[],
): number {
  return (
    clusters.filter(clusterNeedsAttention).length +
    warehouses.filter(warehouseNeedsAttention).length +
    pipelines.filter(pipelineNeedsAttention).length +
    jobRuns.filter(jobRunNeedsAttention).length
  )
}

// ── Documentation links per termination code ─────────────────────────────────

const DBX_DOCS = 'https://docs.databricks.com/en'
const AZ_DOCS  = 'https://learn.microsoft.com/en-us/azure'

interface DocLink { url: string; label: string }

const TERMINATION_DOCS: Record<string, DocLink> = {
  // Azure-specific
  AZURE_QUOTA_EXCEEDED_EXCEPTION: {
    url:   `${AZ_DOCS}/quotas/regional-quota-requests`,
    label: 'Request an Azure quota increase',
  },
  AZURE_OPERATION_NOT_ALLOWED_EXCEPTION: {
    url:   `${AZ_DOCS}/azure-resource-manager/management/azure-subscription-service-limits`,
    label: 'Azure subscription limits',
  },
  AZURE_SPOT_REQUEST_NOT_PROCESSABLE: {
    url:   `${DBX_DOCS}/compute/azure-best-practices.html#spot-instances`,
    label: 'Using spot instances on Azure',
  },
  // Cloud / capacity
  CLOUD_PROVIDER_LAUNCH_FAILURE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html#cloud-provider-launch-failure`,
    label: 'Cluster termination: launch failure',
  },
  CLOUD_PROVIDER_RESOURCE_STOCKOUT: {
    url:   `${DBX_DOCS}/compute/azure-best-practices.html#spot-instances`,
    label: 'Handling cloud resource stockouts',
  },
  TERMINATED_FOR_SPOT_INSTANCE_REPLACEMENT: {
    url:   `${DBX_DOCS}/compute/azure-best-practices.html#spot-instances`,
    label: 'Spot instance preemption',
  },
  UNEXPECTED_LAUNCH_FAILURE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  CONTAINER_LAUNCH_FAILURE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html#container-launch-failure`,
    label: 'Container launch failure',
  },
  REQUEST_REJECTED: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  // Spark / runtime
  SPARK_STARTUP_FAILURE: {
    url:   `${DBX_DOCS}/compute/configure.html`,
    label: 'Cluster configuration reference',
  },
  WORKER_STARTUP_FAILURE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  INIT_SCRIPT_FAILURE: {
    url:   `${DBX_DOCS}/init-scripts/index.html`,
    label: 'Init script documentation',
  },
  LIBRARIES_INSTALL_FAILURE: {
    url:   `${DBX_DOCS}/libraries/index.html`,
    label: 'Library management',
  },
  // Driver / connectivity
  DRIVER_UNREACHABLE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html#driver-unreachable`,
    label: 'Driver unreachable troubleshooting',
  },
  DRIVER_UNRESPONSIVE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  CLUSTER_UNREACHABLE: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  // Resource exhaustion
  DISK_FULL: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html#disk-full`,
    label: 'Disk full troubleshooting',
  },
  MEMORY_EXHAUSTED: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  // Infrastructure
  NETWORK_CONFIGURATION: {
    url:   `${DBX_DOCS}/security/network/index.html`,
    label: 'Network configuration guide',
  },
  DBFS_COMPONENT_UNHEALTHY: {
    url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
    label: 'Cluster termination reasons',
  },
  METASTORE_COMPONENT_UNHEALTHY: {
    url:   `${DBX_DOCS}/data-governance/unity-catalog/index.html`,
    label: 'Unity Catalog / metastore docs',
  },
  INSTANCE_POOL_CLUSTER_FAILURE: {
    url:   `${DBX_DOCS}/compute/pool-index.html`,
    label: 'Instance pool documentation',
  },
  // Job / pipeline errors (catch-all via fallback)
}

/** Fallback doc link for any unmapped code. */
const FALLBACK_DOC: DocLink = {
  url:   `${DBX_DOCS}/error-messages/cluster-termination-reasons.html`,
  label: 'Cluster termination reasons',
}

function docForCode(code: string): DocLink {
  return TERMINATION_DOCS[code] ?? FALLBACK_DOC
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-2 mb-2 mt-5 first:mt-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-100 text-red-700 text-xs font-bold">
        {count}
      </span>
    </div>
  )
}

function ErrorDetail({
  message,
  code,
  terminationType,
}: {
  message: string
  code?: string
  terminationType?: string
}) {
  if (!message && !code) return null
  const doc = code ? docForCode(code) : null
  const isError = terminationType === 'CLIENT_ERROR' || terminationType === 'SERVICE_FAULT'

  return (
    <div className={`mt-2 rounded-md px-3 py-2 text-xs leading-relaxed ${isError ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'}`}>
      {/* Code badge + doc link on one line */}
      {code && (
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="font-mono font-semibold text-gray-700 bg-white border border-gray-200 rounded px-1.5 py-0.5">
            {code}
          </span>
          {doc && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
              {doc.label}
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>
      )}
      {/* Full message — no truncation */}
      {message && (
        <p className={`break-words whitespace-pre-wrap ${isError ? 'text-red-700' : 'text-gray-600'}`}>
          {message}
        </p>
      )}
    </div>
  )
}

function ResourceLink({
  href, name, host,
}: { href: string | null; name: string; host?: string }) {
  if (!href || !host) return <span className="font-medium">{name}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium hover:text-dbx-red hover:underline"
    >
      {name}
    </a>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  clusters: Cluster[]
  warehouses: Warehouse[]
  pipelines: Pipeline[]
  jobRuns: JobRun[]
  workspaceHosts: Record<string, string>
}

export function NeedsAttentionTab({
  clusters, warehouses, pipelines, jobRuns, workspaceHosts,
}: Props) {
  const badClusters   = clusters.filter(clusterNeedsAttention)
  const badWarehouses = warehouses.filter(warehouseNeedsAttention)
  const badPipelines  = pipelines.filter(pipelineNeedsAttention)
  const badJobRuns    = jobRuns.filter(jobRunNeedsAttention)
  const total = badClusters.length + badWarehouses.length + badPipelines.length + badJobRuns.length

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
        <span className="text-4xl">✓</span>
        <p className="text-sm font-medium text-gray-500">All compute looks healthy</p>
        <p className="text-xs text-gray-400">No errors or failed resources detected</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">

      {/* ── Platform status quick-links ── */}
      <div className="flex items-center gap-2 pb-1 flex-wrap">
        <span className="text-xs text-gray-400">Platform status:</span>
        <a
          href="https://status.databricks.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm transition"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Databricks
          <svg className="w-2.5 h-2.5 text-gray-300" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
            <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <a
          href="https://azure.status.microsoft/en-us/status"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm transition"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          Azure
          <svg className="w-2.5 h-2.5 text-gray-300" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
            <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>

      {/* ── Clusters ── */}
      <SectionHeader label="Clusters" count={badClusters.length} />
      {badClusters.map(c => {
        const host = workspaceHosts[c.workspace]
        return (
          <div key={`${c.workspace}:${c.id}`} className="rounded-lg border border-red-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ResourceLink href={host ? clusterUrl(host, c.id) : null} name={c.name} host={host} />
                  {host ? (
                    <a href={workspaceUrl(host)} target="_blank" rel="noopener noreferrer"
                       className="text-xs text-gray-400 hover:text-dbx-red hover:underline" title={host}>
                      {c.workspace}
                    </a>
                  ) : <span className="text-xs text-gray-400">{c.workspace}</span>}
                  <StateBadge state={c.state} />
                  {c.termination_type && (
                    <span className="state-badge bg-red-100 text-red-700 text-xs">
                      {c.termination_type.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <ErrorDetail
                  message={c.state_message}
                  code={c.termination_code}
                  terminationType={c.termination_type}
                />
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap pt-0.5">{c.creator}</span>
            </div>
          </div>
        )
      })}

      {/* ── Warehouses ── */}
      <SectionHeader label="SQL Warehouses" count={badWarehouses.length} />
      {badWarehouses.map(w => {
        const host = workspaceHosts[w.workspace]
        return (
          <div key={`${w.workspace}:${w.id}`} className="rounded-lg border border-red-200 bg-white p-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ResourceLink href={host ? warehouseUrl(host, w.id) : null} name={w.name} host={host} />
              {host ? (
                <a href={workspaceUrl(host)} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-gray-400 hover:text-dbx-red hover:underline" title={host}>
                  {w.workspace}
                </a>
              ) : <span className="text-xs text-gray-400">{w.workspace}</span>}
              <StateBadge state={w.state} />
              <span className="text-xs text-gray-400">{w.type} · {w.size}</span>
              <a
                href={`${DBX_DOCS}/compute/sql-warehouse/index.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline ml-1"
              >
                Warehouse docs
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        )
      })}

      {/* ── Pipelines ── */}
      <SectionHeader label="DLT Pipelines" count={badPipelines.length} />
      {badPipelines.map(p => {
        const host = workspaceHosts[p.workspace]
        return (
          <div key={`${p.workspace}:${p.id}`} className="rounded-lg border border-red-200 bg-white p-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ResourceLink href={host ? pipelineUrl(host, p.id) : null} name={p.name} host={host} />
              {host ? (
                <a href={workspaceUrl(host)} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-gray-400 hover:text-dbx-red hover:underline" title={host}>
                  {p.workspace}
                </a>
              ) : <span className="text-xs text-gray-400">{p.workspace}</span>}
              <span className="state-badge bg-red-100 text-red-800">{p.state}</span>
              <span className="text-xs text-gray-400">{p.creator}</span>
              <a
                href={`${DBX_DOCS}/delta-live-tables/troubleshooting.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline ml-1"
              >
                DLT troubleshooting
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        )
      })}

      {/* ── Job Runs ── */}
      <SectionHeader label="Job Runs" count={badJobRuns.length} />
      {badJobRuns.map(r => {
        const host = workspaceHosts[r.workspace]
        const isInternalError = r.state === 'INTERNAL_ERROR'
        return (
          <div key={`${r.workspace}:${r.run_id}`} className="rounded-lg border border-red-200 bg-white p-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ResourceLink
                href={host ? jobRunUrl(host, r.job_id, r.run_id) : null}
                name={r.run_name}
                host={host}
              />
              {host ? (
                <a href={workspaceUrl(host)} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-gray-400 hover:text-dbx-red hover:underline" title={host}>
                  {r.workspace}
                </a>
              ) : <span className="text-xs text-gray-400">{r.workspace}</span>}
              <span className={`state-badge ${isInternalError ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}`}>
                {r.state}
              </span>
              {r.result_state && (
                <span className="state-badge bg-red-100 text-red-700">{r.result_state}</span>
              )}
              <span className="text-xs text-gray-400">job {r.job_id}</span>
              <a
                href={`${DBX_DOCS}/jobs/index.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline ml-1"
              >
                Job run docs
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3.5 8.5l5-5M5 3.5h3.5V7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        )
      })}
    </div>
  )
}
