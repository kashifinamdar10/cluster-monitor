import type { JobRun } from '../types'
import { useTableSort, useColumnResize } from '../hooks/useTableFeatures'
import { jobRunUrl, workspaceUrl } from '../utils/workspaceLinks'

const LIFECYCLE_CLASSES: Record<string, string> = {
  PENDING:                'bg-yellow-100 text-yellow-800',
  RUNNING:                'bg-green-100 text-green-800',
  TERMINATING:            'bg-blue-100 text-blue-700',
  TERMINATED:             'bg-gray-100 text-gray-600',
  SKIPPED:                'bg-gray-100 text-gray-500',
  INTERNAL_ERROR:         'bg-red-100 text-red-800',
  WAITING_FOR_RETRY:      'bg-yellow-100 text-yellow-700',
  BLOCKED:                'bg-orange-100 text-orange-700',
  WAITING_FOR_CONDITION:  'bg-blue-100 text-blue-600',
  UNKNOWN:                'bg-gray-100 text-gray-500',
}

const RESULT_CLASSES: Record<string, string> = {
  SUCCESS:                'bg-green-100 text-green-700',
  FAILED:                 'bg-red-100 text-red-700',
  TIMEDOUT:               'bg-orange-100 text-orange-700',
  CANCELED:               'bg-gray-100 text-gray-500',
  SUCCESS_WITH_FAILURES:  'bg-yellow-100 text-yellow-700',
  UPSTREAM_FAILED:        'bg-red-100 text-red-600',
  UPSTREAM_CANCELED:      'bg-gray-100 text-gray-500',
}

function LifecycleBadge({ state }: { state: string }) {
  const cls = LIFECYCLE_CLASSES[state?.toUpperCase()] ?? 'bg-gray-100 text-gray-500'
  return <span className={`state-badge ${cls}`}>{state}</span>
}

function ResultBadge({ state }: { state: string }) {
  if (!state) return null
  const cls = RESULT_CLASSES[state?.toUpperCase()] ?? 'bg-gray-100 text-gray-500'
  return <span className={`state-badge ${cls}`}>{state}</span>
}

function fmtDuration(ms: number): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtStart(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('en-US', {
    month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

interface Props {
  jobRuns: JobRun[]
  workspaceFilter: string
  stateFilter: string
  workspaceHosts: Record<string, string>
}

const COLS = [
  { label: 'Workspace', key: 'workspace',      w: 120 },
  { label: 'Run Name',  key: 'run_name',        w: 220 },
  { label: 'Job ID',    key: 'job_id',          w: 80  },
  { label: 'Status',    key: 'state',           w: 120 },
  { label: 'Result',    key: 'result_state',    w: 120 },
  { label: 'Type',      key: 'run_type',        w: 100 },
  { label: 'Trigger',   key: 'trigger',         w: 90  },
  { label: 'Started',   key: 'start_time_ms',   w: 140 },
  { label: 'Duration',  key: 'duration_ms',     w: 90  },
] as const

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (active) return <span className="text-blue-500 text-xs">{dir === 'asc' ? '↑' : '↓'}</span>
  return <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100">↕</span>
}

export function JobRunsTable({ jobRuns, workspaceFilter, stateFilter, workspaceHosts }: Props) {
  const filtered = jobRuns.filter(r => {
    if (workspaceFilter && r.workspace !== workspaceFilter) return false
    if (stateFilter && r.state !== stateFilter) return false
    return true
  })

  const { sortKey, sortDir, toggleSort, sorted } = useTableSort(filtered)
  const { widths, onDragStart, onDragMove, onDragEnd } = useColumnResize(COLS.map(c => c.w))

  const running = filtered.filter(r => r.state === 'RUNNING').length

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xs text-gray-400">{filtered.length} active runs</span>
        {running > 0 && <span className="state-badge bg-green-100 text-green-700">{running} running</span>}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-gray-400 text-sm">
          No active job runs{(workspaceFilter || stateFilter) ? ' matching current filters' : ''}
        </div>
      ) : (
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
                    <button
                      className="flex items-center gap-1 group w-full text-left"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    </button>
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
              {(sorted as unknown as JobRun[]).map(r => (
                <tr key={`${r.workspace}-${r.run_id}`} className="hover:bg-gray-50">
                  <td className="table-td text-gray-500 truncate">
                    {workspaceHosts[r.workspace] ? (
                      <a href={workspaceUrl(workspaceHosts[r.workspace])} target="_blank" rel="noopener noreferrer"
                         className="hover:text-dbx-red hover:underline" title={workspaceHosts[r.workspace]}>
                        {r.workspace}
                      </a>
                    ) : r.workspace}
                  </td>
                  <td className="table-td font-medium truncate">
                    {workspaceHosts[r.workspace] ? (
                      <a
                        href={jobRunUrl(workspaceHosts[r.workspace], r.job_id, r.run_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-dbx-red hover:underline"
                        title={`Open run in Databricks: job ${r.job_id} / run ${r.run_id}`}
                      >
                        {r.run_name}
                      </a>
                    ) : r.run_name}
                  </td>
                  <td className="table-td text-gray-400 font-mono text-xs">
                    {workspaceHosts[r.workspace] ? (
                      <a
                        href={`${workspaceHosts[r.workspace]}/jobs/${r.job_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-dbx-red hover:underline"
                        title="Open job definition"
                      >
                        {r.job_id}
                      </a>
                    ) : r.job_id}
                  </td>
                  <td className="table-td"><LifecycleBadge state={r.state} /></td>
                  <td className="table-td"><ResultBadge state={r.result_state} /></td>
                  <td className="table-td text-gray-500 text-xs truncate">{r.run_type}</td>
                  <td className="table-td text-gray-500 text-xs">{r.trigger}</td>
                  <td className="table-td text-gray-400 text-xs whitespace-nowrap">{fmtStart(r.start_time_ms)}</td>
                  <td className="table-td text-gray-500">{fmtDuration(r.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
