import type { Cluster, Warehouse } from '../types'

interface Props {
  clusters: Cluster[]
  warehouses: Warehouse[]
}

export function TagBreakdown({ clusters, warehouses }: Props) {
  const tagData: Record<string, { running: number; stopped: number; other: number; total: number }> = {}

  for (const item of [...clusters, ...warehouses]) {
    for (const [k, v] of Object.entries(item.tags)) {
      const key = `${k}=${v}`
      if (!tagData[key]) tagData[key] = { running: 0, stopped: 0, other: 0, total: 0 }
      tagData[key].total++
      if (item.state === 'RUNNING') tagData[key].running++
      else if (['TERMINATED', 'STOPPED'].includes(item.state)) tagData[key].stopped++
      else tagData[key].other++
    }
  }

  const rows = Object.entries(tagData).sort(([a], [b]) => a.localeCompare(b))

  if (rows.length === 0) {
    return <p className="text-gray-400 text-sm mt-4">No tagged resources found.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 mt-3">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead>
          <tr>
            {['Tag', 'Total', 'Running', 'Stopped', 'Other'].map(h => (
              <th key={h} className="table-th">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map(([tag, d]) => (
            <tr key={tag} className="hover:bg-gray-50">
              <td className="table-td font-medium text-gray-700">{tag}</td>
              <td className="table-td">{d.total}</td>
              <td className="table-td">
                <span className="state-badge bg-green-100 text-green-800">{d.running}</span>
              </td>
              <td className="table-td">
                <span className="state-badge bg-gray-100 text-gray-600">{d.stopped}</span>
              </td>
              <td className="table-td">
                <span className="state-badge bg-yellow-100 text-yellow-700">{d.other}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
