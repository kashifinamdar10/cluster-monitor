import { useState } from 'react'
import type { HistoryResponse } from '../types'
import { StateBadge } from './StateBadge'

import type { LogLevel } from '../types'

export function HistoryTab({ onLog }: { onLog: (level: LogLevel, msg: string) => void }) {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    onLog('info', `History: loading (${hours}h window)…`)
    try {
      const res = await fetch(`/api/history?hours=${hours}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d: HistoryResponse = await res.json()
      setData(d)
      if (!d.available) {
        onLog('warning', 'History: Lakebase not configured.')
      } else {
        onLog('success', `History: loaded (${d.changes.length} transitions, ${d.uptime.length} uptime rows)`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onLog('error', `History failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  function fmtTime(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Time range</label>
          <select
            className="input-select"
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
          >
            <option value={1}>Last 1 hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 72 hours</option>
          </select>
        </div>
        <button className="btn-outline" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↺ Load history'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {data && !data.available && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 mb-4">
          Lakebase not configured. Set <code>LAKEBASE_INSTANCE_NAME</code> to enable history.
        </div>
      )}

      {data && data.available && (
        <>
          <h3 className="font-semibold text-gray-700 mb-1">State Changes</h3>
          <p className="text-xs text-gray-400 mb-2">Transitions in the last {hours} hours</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200 mb-6">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  {['Time', 'Type', 'Name', 'Workspace', 'From', '', 'To'].map((h, i) => (
                    <th key={i} className="table-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.changes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-td text-center text-gray-400 py-8">
                      No state changes in the last {hours} hours
                    </td>
                  </tr>
                ) : (
                  data.changes.map((ch, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="table-td text-gray-400 text-xs whitespace-nowrap">{fmtTime(ch.snapshot_time)}</td>
                      <td className="table-td text-gray-500">{ch.resource_type}</td>
                      <td className="table-td font-medium">{ch.resource_name}</td>
                      <td className="table-td text-gray-500">{ch.workspace}</td>
                      <td className="table-td"><StateBadge state={ch.prev_state} /></td>
                      <td className="table-td text-gray-400">→</td>
                      <td className="table-td"><StateBadge state={ch.state} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3 className="font-semibold text-gray-700 mb-1">Uptime Summary</h3>
          <p className="text-xs text-gray-400 mb-2">% of snapshots where resource was RUNNING (last {hours}h)</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr>
                  {['Type', 'Name', 'Workspace', 'Uptime %', ''].map((h, i) => (
                    <th key={i} className="table-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.uptime.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table-td text-center text-gray-400 py-8">
                      No data in the last {hours} hours
                    </td>
                  </tr>
                ) : (
                  data.uptime.map((u, i) => {
                    const pct = u.total_snapshots
                      ? Math.round((100 * u.running_snapshots) / u.total_snapshots)
                      : 0
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="table-td text-gray-500">{u.resource_type}</td>
                        <td className="table-td font-medium">{u.resource_name}</td>
                        <td className="table-td text-gray-500">{u.workspace}</td>
                        <td className="table-td font-semibold">{pct}%</td>
                        <td className="table-td w-40">
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct >= 50 ? 'bg-green-500' : 'bg-yellow-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
