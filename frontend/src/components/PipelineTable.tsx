import type { Pipeline } from '../types'
import { useTableSort, useColumnResize } from '../hooks/useTableFeatures'
import { pipelineUrl, workspaceUrl } from '../utils/workspaceLinks'

const PIPELINE_STATE_CLASSES: Record<string, string> = {
  RUNNING:    'bg-green-100 text-green-800',
  STARTING:   'bg-yellow-100 text-yellow-800',
  DEPLOYING:  'bg-yellow-100 text-yellow-800',
  RECOVERING: 'bg-blue-100 text-blue-700',
  RESETTING:  'bg-blue-100 text-blue-700',
  STOPPING:   'bg-blue-100 text-blue-700',
  IDLE:       'bg-gray-100 text-gray-500',
  FAILED:     'bg-red-100 text-red-800',
  DELETED:    'bg-gray-200 text-gray-400',
  UNKNOWN:    'bg-gray-100 text-gray-500',
}

function PipelineBadge({ state }: { state: string }) {
  const cls = PIPELINE_STATE_CLASSES[state?.toUpperCase()] ?? 'bg-gray-100 text-gray-500'
  return <span className={`state-badge ${cls}`}>{state}</span>
}

function UpdateDots({ updates }: { updates: Pipeline['latest_updates'] }) {
  if (!updates.length) return <span className="text-gray-300">—</span>
  return (
    <span className="flex items-center gap-1">
      {updates.map((u, i) => {
        const cls = PIPELINE_STATE_CLASSES[u.state?.toUpperCase()] ?? 'bg-gray-200'
        return (
          <span
            key={i}
            title={`${u.state} (${u.update_id.slice(0, 8)}…)`}
            className={`inline-block w-2.5 h-2.5 rounded-full ${cls.split(' ')[0]}`}
          />
        )
      })}
    </span>
  )
}

interface Props {
  pipelines: Pipeline[]
  workspaceFilter: string
  stateFilter: string
  workspaceHosts: Record<string, string>
}

const COLS = [
  { label: 'Workspace',      key: 'workspace', w: 130 },
  { label: 'Pipeline Name',  key: 'name',      w: 240 },
  { label: 'State',          key: 'state',     w: 110 },
  { label: 'Creator',        key: 'creator',   w: 160 },
  { label: 'Recent Updates', key: null,        w: 120 },
  { label: 'Cluster ID',     key: 'cluster_id', w: 150 },
] as const

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (active) return <span className="text-blue-500 text-xs">{dir === 'asc' ? '↑' : '↓'}</span>
  return <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100">↕</span>
}

export function PipelineTable({ pipelines, workspaceFilter, stateFilter, workspaceHosts }: Props) {
  const filtered = pipelines.filter(p => {
    if (workspaceFilter && p.workspace !== workspaceFilter) return false
    if (stateFilter && p.state !== stateFilter) return false
    return true
  })

  const { sortKey, sortDir, toggleSort, sorted } = useTableSort(filtered)
  const { widths, onDragStart, onDragMove, onDragEnd } = useColumnResize(COLS.map(c => c.w))

  const running = filtered.filter(p => p.state === 'RUNNING').length
  const failed  = filtered.filter(p => p.state === 'FAILED').length

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xs text-gray-400">{filtered.length} pipelines</span>
        {running > 0 && <span className="state-badge bg-green-100 text-green-700">{running} running</span>}
        {failed  > 0 && <span className="state-badge bg-red-100 text-red-700">{failed} failed</span>}
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
                  key={col.label}
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
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="table-td text-center text-gray-400 py-8">
                  No pipelines match current filters
                </td>
              </tr>
            ) : (
              (sorted as unknown as Pipeline[]).map(p => (
                <tr key={`${p.workspace}-${p.id}`} className="hover:bg-gray-50">
                  <td className="table-td text-gray-500 truncate">
                    {workspaceHosts[p.workspace] ? (
                      <a href={workspaceUrl(workspaceHosts[p.workspace])} target="_blank" rel="noopener noreferrer"
                         className="hover:text-dbx-red hover:underline" title={workspaceHosts[p.workspace]}>
                        {p.workspace}
                      </a>
                    ) : p.workspace}
                  </td>
                  <td className="table-td font-medium truncate">
                    {workspaceHosts[p.workspace] ? (
                      <a
                        href={pipelineUrl(workspaceHosts[p.workspace], p.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-dbx-red hover:underline"
                        title={`Open in Databricks: ${p.id}`}
                      >
                        {p.name}
                      </a>
                    ) : p.name}
                  </td>
                  <td className="table-td"><PipelineBadge state={p.state} /></td>
                  <td className="table-td text-gray-500 truncate">{p.creator}</td>
                  <td className="table-td"><UpdateDots updates={p.latest_updates} /></td>
                  <td className="table-td text-gray-400 font-mono text-xs truncate">
                    {p.cluster_id ? p.cluster_id.slice(0, 16) + '…' : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
