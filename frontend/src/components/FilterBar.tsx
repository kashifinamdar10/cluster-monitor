import type { Cluster, Warehouse, Filters } from '../types'

interface Props {
  clusters: Cluster[]
  warehouses: Warehouse[]
  filters: Filters
  onChange: (f: Filters) => void
}

function Select({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string
  placeholder: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <select
      className="input-select"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function FilterBar({ clusters, warehouses, filters, onChange }: Props) {
  const all = [...clusters, ...warehouses]

  const tagKeys = [...new Set(all.flatMap(i => Object.keys(i.tags)))].sort()
  const tagValues = filters.tagKey
    ? [...new Set(all.flatMap(i => (i.tags[filters.tagKey] ? [i.tags[filters.tagKey]] : [])))].sort()
    : []
  const workspaces = [...new Set(all.map(i => i.workspace))].sort()
  const states = [...new Set(all.map(i => i.state))].sort()

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Tag Key</label>
        <Select
          value={filters.tagKey}
          placeholder="All tags"
          options={tagKeys}
          onChange={v => onChange({ ...filters, tagKey: v, tagValue: '' })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Tag Value</label>
        <Select
          value={filters.tagValue}
          placeholder="All values"
          options={tagValues}
          onChange={v => onChange({ ...filters, tagValue: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Workspace</label>
        <Select
          value={filters.workspace}
          placeholder="All workspaces"
          options={workspaces}
          onChange={v => onChange({ ...filters, workspace: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">State</label>
        <Select
          value={filters.state}
          placeholder="All states"
          options={states}
          onChange={v => onChange({ ...filters, state: v })}
        />
      </div>
      {(filters.tagKey || filters.tagValue || filters.workspace || filters.state) && (
        <button
          className="btn-outline text-xs"
          onClick={() => onChange({ workspace: '', state: '', tagKey: '', tagValue: '' })}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
