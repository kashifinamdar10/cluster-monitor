import type { Warehouse, Filters } from '../types'
import { StateBadge } from './StateBadge'
import { useTableSort, useColumnResize } from '../hooks/useTableFeatures'
import { warehouseUrl, workspaceUrl } from '../utils/workspaceLinks'

interface Props {
  warehouses: Warehouse[]
  filters: Filters
  loading: boolean
  workspaceHosts: Record<string, string>
}

function applyFilters(warehouses: Warehouse[], filters: Filters) {
  return warehouses.filter(w => {
    if (filters.workspace && w.workspace !== filters.workspace) return false
    if (filters.state && w.state !== filters.state) return false
    if (filters.tagKey && !(filters.tagKey in w.tags)) return false
    if (filters.tagValue && w.tags[filters.tagKey] !== filters.tagValue) return false
    return true
  })
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

function ClusterConfig({ w }: { w: Warehouse }) {
  const range = w.min_num_clusters === w.max_num_clusters
    ? String(w.min_num_clusters)
    : `${w.min_num_clusters}–${w.max_num_clusters}`
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className="font-semibold text-gray-700">{w.size}</span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500">{range}</span>
      {w.num_clusters > 0 && (
        <>
          <span className="text-gray-300">|</span>
          <span className="text-green-600 font-medium">{w.num_clusters} on</span>
        </>
      )}
    </span>
  )
}

const COLS = [
  { label: 'Workspace',       key: 'workspace',       w: 130 },
  { label: 'Name',            key: 'name',            w: 200 },
  { label: 'State',           key: 'state',           w: 110 },
  { label: 'Creator',         key: 'creator',         w: 130 },
  { label: 'Config',          key: 'size',            w: 190 },
  { label: 'Type',            key: 'type',            w: 100 },
  { label: 'Auto-Stop (min)', key: 'auto_stop_mins',  w: 110 },
  { label: 'Tags',            key: 'tag_str',         w: 160 },
] as const

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (active) return <span className="text-blue-500 text-xs">{dir === 'asc' ? '↑' : '↓'}</span>
  return <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100">↕</span>
}

export function WarehouseTable({ warehouses, filters, loading, workspaceHosts }: Props) {
  const filtered = applyFilters(warehouses, filters)
  const { sortKey, sortDir, toggleSort, sorted } = useTableSort(filtered)
  const { widths, onDragStart, onDragMove, onDragEnd } = useColumnResize(COLS.map(c => c.w))
  const showSkeleton = loading && warehouses.length === 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-gray-400">
          {loading && warehouses.length === 0
            ? 'Loading warehouses…'
            : `${filtered.length} of ${warehouses.length} warehouses`}
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
            {showSkeleton ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={COLS.length} />)
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="table-td text-center text-gray-400 py-8">
                  {warehouses.length === 0 ? 'No warehouses found' : 'No warehouses match current filters'}
                </td>
              </tr>
            ) : (
              (sorted as unknown as Warehouse[]).map(w => (
                <tr key={`${w.workspace}-${w.id}`} className="hover:bg-gray-50">
                  <td className="table-td text-gray-500 truncate">
                    {workspaceHosts[w.workspace] ? (
                      <a href={workspaceUrl(workspaceHosts[w.workspace])} target="_blank" rel="noopener noreferrer"
                         className="hover:text-dbx-red hover:underline" title={workspaceHosts[w.workspace]}>
                        {w.workspace}
                      </a>
                    ) : w.workspace}
                  </td>
                  <td className="table-td font-medium truncate">
                    {workspaceHosts[w.workspace] ? (
                      <a
                        href={warehouseUrl(workspaceHosts[w.workspace], w.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-dbx-red hover:underline"
                        title={`Open in Databricks: ${w.id}`}
                      >
                        {w.name}
                      </a>
                    ) : w.name}
                  </td>
                  <td className="table-td"><StateBadge state={w.state} /></td>
                  <td className="table-td text-gray-500 truncate">{w.creator}</td>
                  <td className="table-td"><ClusterConfig w={w} /></td>
                  <td className="table-td text-gray-500 truncate">{w.type}</td>
                  <td className="table-td text-gray-500">{String(w.auto_stop_mins)}</td>
                  <td className="table-td text-gray-400 text-xs truncate">{w.tag_str || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
