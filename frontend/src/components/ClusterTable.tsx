import { useState, useCallback } from 'react'
import type { Cluster, Filters } from '../types'
import { StateBadge } from './StateBadge'
import { useTableSort, useColumnResize } from '../hooks/useTableFeatures'
import { clusterUrl, workspaceUrl } from '../utils/workspaceLinks'

interface Props {
  clusters: Cluster[]
  filters: Filters
  loading: boolean
  onRefreshRow: (clusterId: string, workspace: string) => Promise<boolean>
  workspaceHosts: Record<string, string>
}

function applyFilters(clusters: Cluster[], filters: Filters) {
  return clusters.filter(c => {
    if (filters.workspace && c.workspace !== filters.workspace) return false
    if (filters.state && c.state !== filters.state) return false
    if (filters.tagKey && !(filters.tagKey in c.tags)) return false
    if (filters.tagValue && c.tags[filters.tagKey] !== filters.tagValue) return false
    return true
  })
}

function SpinIcon() {
  return (
    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
    </svg>
  )
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="table-td">
          <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

// ── Termination reason helpers ────────────────────────────────────────────────

const TERMINATION_LABELS: Record<string, { label: string; color: string }> = {
  // Normal endings
  INACTIVITY:                             { label: 'Idle timeout',          color: 'text-gray-500' },
  USER_REQUEST:                           { label: 'User terminated',        color: 'text-gray-500' },
  JOB_FINISHED:                          { label: 'Job finished',           color: 'text-gray-400' },
  RESTARTED:                              { label: 'Restarted',              color: 'text-gray-400' },
  // Capacity / cloud errors
  AZURE_QUOTA_EXCEEDED_EXCEPTION:        { label: 'Quota exceeded',         color: 'text-red-600'  },
  AZURE_OPERATION_NOT_ALLOWED_EXCEPTION: { label: 'Operation not allowed',  color: 'text-red-600'  },
  AZURE_SPOT_REQUEST_NOT_PROCESSABLE:    { label: 'Spot unavailable',       color: 'text-orange-500' },
  CLOUD_PROVIDER_LAUNCH_FAILURE:         { label: 'Launch failure',         color: 'text-red-600'  },
  CLOUD_PROVIDER_RESOURCE_STOCKOUT:      { label: 'Capacity unavailable',   color: 'text-orange-500' },
  REQUEST_REJECTED:                      { label: 'Request rejected',       color: 'text-orange-500' },
  INSTANCE_POOL_CLUSTER_FAILURE:         { label: 'Instance pool failure',  color: 'text-red-600'  },
  TERMINATED_FOR_SPOT_INSTANCE_REPLACEMENT: { label: 'Spot reclaimed',      color: 'text-yellow-600' },
  UNEXPECTED_LAUNCH_FAILURE:             { label: 'Unexpected launch fail',  color: 'text-red-600'  },
  CONTAINER_LAUNCH_FAILURE:              { label: 'Container launch failed', color: 'text-red-600'  },
  // Spark / runtime errors
  SPARK_STARTUP_FAILURE:                 { label: 'Spark startup failed',   color: 'text-red-600'  },
  SPARK_ERROR:                           { label: 'Spark error',            color: 'text-red-600'  },
  WORKER_STARTUP_FAILURE:                { label: 'Worker startup failed',  color: 'text-red-600'  },
  INIT_SCRIPT_FAILURE:                   { label: 'Init script failed',     color: 'text-red-600'  },
  LIBRARIES_INSTALL_FAILURE:             { label: 'Library install failed', color: 'text-red-600'  },
  // Driver / connectivity
  DRIVER_UNREACHABLE:                    { label: 'Driver unreachable',     color: 'text-red-500'  },
  DRIVER_UNRESPONSIVE:                   { label: 'Driver unresponsive',    color: 'text-red-500'  },
  CLUSTER_UNREACHABLE:                   { label: 'Cluster unreachable',    color: 'text-red-500'  },
  // Resource exhaustion
  DISK_FULL:                             { label: 'Disk full',              color: 'text-orange-500' },
  MEMORY_EXHAUSTED:                      { label: 'Memory exhausted',       color: 'text-orange-500' },
  // Infrastructure
  NETWORK_CONFIGURATION:                 { label: 'Network config error',   color: 'text-red-500'  },
  DBFS_COMPONENT_UNHEALTHY:              { label: 'DBFS unhealthy',         color: 'text-red-500'  },
  METASTORE_COMPONENT_UNHEALTHY:         { label: 'Metastore unhealthy',    color: 'text-red-500'  },
  EXECUTION_COMPONENT_UNHEALTHY:         { label: 'Execution unhealthy',    color: 'text-red-500'  },
}

function reasonCell(c: Cluster): { label: string; color: string } | null {
  if (c.termination_code) {
    const known = TERMINATION_LABELS[c.termination_code]
    if (known) return known
    // Unknown code — humanise it (SOME_CODE → Some code)
    const label = c.termination_code.replace(/_/g, ' ').toLowerCase()
      .replace(/^./, s => s.toUpperCase())
    const color = c.termination_type === 'CLIENT_ERROR' || c.termination_type === 'SERVICE_FAULT'
      ? 'text-red-600' : 'text-gray-500'
    return { label, color }
  }
  if (c.state_message) {
    // Non-terminal messages (e.g. "Finding instances…", "Starting Spark")
    const msg = c.state_message.length > 48
      ? c.state_message.slice(0, 46) + '…'
      : c.state_message
    return { label: msg, color: 'text-gray-400' }
  }
  return null
}

// Column definition: label, sort key (null = not sortable), default width
const COLS = [
  { label: 'Workspace',  key: 'workspace',     w: 120 },
  { label: 'Name',       key: 'name',          w: 180 },
  { label: 'State',      key: 'state',         w: 120 },
  { label: 'Reason',     key: null,            w: 160 },
  { label: 'Creator',    key: 'creator',       w: 130 },
  { label: 'Node Type',  key: 'node_type',     w: 130 },
  { label: 'Workers',    key: 'num_workers',   w: 75  },
  { label: 'Tags',       key: 'tag_str',       w: 160 },
  { label: '',           key: null,            w: 48  },
] as const

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (active) return <span className="text-blue-500 text-xs">{dir === 'asc' ? '↑' : '↓'}</span>
  return <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100">↕</span>
}

export function ClusterTable({ clusters, filters, loading, onRefreshRow, workspaceHosts }: Props) {
  const filtered = applyFilters(clusters, filters)
  const { sortKey, sortDir, toggleSort, sorted } = useTableSort(filtered)
  const { widths, onDragStart, onDragMove, onDragEnd } = useColumnResize(COLS.map(c => c.w))
  const showSkeleton = loading && clusters.length === 0

  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())

  const handleRowRefresh = useCallback(
    async (c: Cluster) => {
      const key = `${c.workspace}:${c.id}`
      setRefreshing(prev => new Set(prev).add(key))
      try { await onRefreshRow(c.id, c.workspace) }
      finally {
        setRefreshing(prev => { const n = new Set(prev); n.delete(key); return n })
      }
    },
    [onRefreshRow],
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-gray-400">
          {loading && clusters.length === 0
            ? 'Loading clusters…'
            : `${filtered.length} of ${clusters.length} clusters`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              {COLS.map((col, i) => (
                <th
                  key={col.label || `col-${i}`}
                  className="table-th select-none"
                  style={{ position: 'relative', overflow: 'hidden' }}
                >
                  {col.key ? (
                    <button
                      className="flex items-center gap-1 group w-full text-left"
                      onClick={() => toggleSort(col.key!)}
                    >
                      {col.label}
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    </button>
                  ) : col.label}
                  <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400/40 active:bg-blue-500/60"
                    style={{ touchAction: 'none' }}
                    onPointerDown={onDragStart(i)}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {showSkeleton ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={COLS.length} />)
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="table-td text-center text-gray-400 py-8">
                  {clusters.length === 0 ? 'No clusters found' : 'No clusters match current filters'}
                </td>
              </tr>
            ) : (
              (sorted as unknown as Cluster[]).map(c => {
                const key = `${c.workspace}:${c.id}`
                const isRefreshing = refreshing.has(key)
                return (
                  <tr key={key} className="hover:bg-gray-50">
                    <td className="table-td text-gray-500 truncate">
                      {workspaceHosts[c.workspace] ? (
                        <a href={workspaceUrl(workspaceHosts[c.workspace])} target="_blank" rel="noopener noreferrer"
                           className="hover:text-dbx-red hover:underline" title={workspaceHosts[c.workspace]}>
                          {c.workspace}
                        </a>
                      ) : c.workspace}
                    </td>
                    <td className="table-td font-medium truncate">
                      {workspaceHosts[c.workspace] ? (
                        <a
                          href={clusterUrl(workspaceHosts[c.workspace], c.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-dbx-red hover:underline"
                          title={`Open in Databricks: ${c.id}`}
                        >
                          {c.name}
                        </a>
                      ) : c.name}
                    </td>
                    <td className="table-td">
                      <StateBadge state={c.state} />
                    </td>
                    <td className="table-td text-gray-500 truncate">
                      {(() => {
                        const r = reasonCell(c)
                        if (!r) return <span className="text-gray-300">—</span>
                        return (
                          <span
                            className={`truncate text-xs ${r.color}`}
                            title={[c.state_message, c.termination_code ? `Code: ${c.termination_code}` : ''].filter(Boolean).join('\n')}
                          >
                            {r.label}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="table-td text-gray-500 truncate">{c.creator}</td>
                    <td className="table-td text-gray-500 truncate">{c.node_type}</td>
                    <td className="table-td text-gray-500">{String(c.num_workers)}</td>
                    <td className="table-td text-gray-400 text-xs truncate">{c.tag_str || '—'}</td>
                    <td className="table-td w-8 text-center">
                      <button
                        onClick={() => handleRowRefresh(c)}
                        disabled={isRefreshing}
                        title={`Refresh ${c.name}`}
                        className={[
                          'inline-flex items-center justify-center rounded p-1 transition-colors',
                          'focus:outline-none focus:ring-2 focus:ring-dbx-red focus:ring-offset-1',
                          isRefreshing
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-dbx-red hover:bg-red-50',
                        ].join(' ')}
                      >
                        {isRefreshing ? <SpinIcon /> : <RefreshIcon />}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
