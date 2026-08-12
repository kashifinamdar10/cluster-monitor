import { useState, useEffect, useCallback, useRef } from 'react'
import type { Cluster, Warehouse, Pipeline, JobRun, LogEntry, LogLevel } from '../types'

export const REFRESH_INTERVALS: Record<string, number | null> = {
  '30s': 30_000,
  '60s': 60_000,
  '2min': 120_000,
  '5min': 300_000,
  Off: null,
}

export type Phase = 'clusters' | 'warehouses' | 'pipelines' | 'job_runs'

interface SnapshotPayload {
  available: boolean
  snapshot_time?: string | null
  scrape_run_id?: string | null
  scrape_status?: string | null
  scrape_counts?: Record<string, number>
  clusters?: Cluster[]
  warehouses?: Warehouse[]
  pipelines?: Pipeline[]
  job_runs?: JobRun[]
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function entry(level: LogLevel, message: string): LogEntry {
  return { time: ts(), level, message }
}

function formatSnapshotLabel(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function useComputeData() {
  const [clusters, setClusters]       = useState<Cluster[]>([])
  const [warehouses, setWarehouses]   = useState<Warehouse[]>([])
  const [pipelines, setPipelines]     = useState<Pipeline[]>([])
  const [jobRuns, setJobRuns]         = useState<JobRun[]>([])
  const [loading, setLoading]         = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [scrapeRunId, setScrapeRunId] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<string>(() => {
    try { return localStorage.getItem('cluster-monitor:refresh-interval') ?? 'Off' } catch { return 'Off' }
  })
  const [log, setLog] = useState<LogEntry[]>([])

  const [phaseLastRefreshed, setPhaseLastRefreshed] = useState<Record<Phase | 'all', number | null>>({
    clusters: null, warehouses: null, pipelines: null, job_runs: null, all: null,
  })

  const [workspaceHosts, setWorkspaceHosts] = useState<Record<string, string>>({})

  const fetchWorkspaces = useCallback(() => {
    fetch('/api/workspaces')
      .then(r => r.ok ? r.json() : [])
      .then((list: { name: string; host: string }[]) => {
        const map: Record<string, string> = {}
        for (const { name, host } of list) map[name] = host
        setWorkspaceHosts(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchWorkspaces() }, [fetchWorkspaces])

  const reloadWorkspaces = useCallback(() => { fetchWorkspaces() }, [fetchWorkspaces])

  function stampPhase(phase: Phase | 'all') {
    setPhaseLastRefreshed(prev => ({ ...prev, [phase]: Date.now() }))
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(false)

  const pushLog = useCallback((level: LogLevel, message: string) => {
    setLog(prev => [entry(level, message), ...prev].slice(0, 400))
  }, [])

  const clearLog = useCallback(() => setLog([]), [])

  const applySnapshot = useCallback((data: SnapshotPayload, verbose: boolean, label: string) => {
    if (!data.available) {
      if (verbose) pushLog('warning', `${label}: no Lakebase snapshot available yet`)
      return false
    }
    setClusters(data.clusters ?? [])
    setWarehouses(data.warehouses ?? [])
    setPipelines(data.pipelines ?? [])
    setJobRuns(data.job_runs ?? [])
    setScrapeRunId(data.scrape_run_id ?? null)
    const labelTime = formatSnapshotLabel(data.snapshot_time)
    setLastRefresh(labelTime)
    stampPhase('all')
    stampPhase('clusters')
    stampPhase('warehouses')
    stampPhase('pipelines')
    stampPhase('job_runs')
    const counts = data.scrape_counts || {}
    pushLog(
      'success',
      `${label}: snapshot ${labelTime}` +
        (data.scrape_run_id ? ` (${data.scrape_run_id})` : '') +
        ` — ${data.clusters?.length ?? counts.clusters ?? 0} clusters, ` +
        `${data.warehouses?.length ?? counts.warehouses ?? 0} warehouses, ` +
        `${data.pipelines?.length ?? counts.pipelines ?? 0} pipelines, ` +
        `${data.job_runs?.length ?? counts.job_runs ?? 0} job runs`,
    )
    return true
  }, [pushLog])

  const loadSnapshot = useCallback(async (label: string, verbose: boolean): Promise<boolean> => {
    try {
      const res = await fetch('/api/snapshot/latest')
      if (!res.ok) {
        pushLog('error', `${label}: HTTP ${res.status}`)
        return false
      }
      const data = (await res.json()) as SnapshotPayload
      return applySnapshot(data, verbose, label)
    } catch (err) {
      pushLog('error', `${label}: ${String(err)}`)
      return false
    }
  }, [applySnapshot, pushLog])

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** Trigger classic scrape job, then poll Lakebase until scrape_run_id changes (or timeout). */
  const triggerAndPoll = useCallback(async (label: string, verbose: boolean): Promise<boolean> => {
    setLoading(true)
    abortRef.current = false
    const previousRunId = scrapeRunId

    try {
      if (verbose) pushLog('info', `${label}: triggering classic scrape job…`)
      const trig = await fetch('/api/snapshot/trigger', { method: 'POST' })
      if (trig.ok) {
        const body = await trig.json()
        pushLog('info', `Job run ${body.run_id} started — waiting for Lakebase snapshot…`)
      } else {
        const detail = await trig.text()
        pushLog(
          'warning',
          `Could not trigger job (HTTP ${trig.status}) — reloading latest snapshot. ${detail.slice(0, 180)}`,
        )
        const ok = await loadSnapshot(label, verbose)
        setLoading(false)
        return ok
      }

      const deadline = Date.now() + 180_000
      while (Date.now() < deadline && !abortRef.current) {
        await sleep(5_000)
        if (abortRef.current) break
        const res = await fetch('/api/snapshot/latest')
        if (!res.ok) continue
        const data = (await res.json()) as SnapshotPayload
        if (
          data.available &&
          data.scrape_status === 'completed' &&
          data.scrape_run_id &&
          data.scrape_run_id !== previousRunId
        ) {
          applySnapshot(data, verbose, label)
          setLoading(false)
          return true
        }
        if (verbose) {
          pushLog('info', `Waiting for scrape… status=${data.scrape_status ?? 'n/a'}`)
        }
      }

      pushLog('warning', `${label}: timed out waiting for new scrape — loading latest available`)
      const ok = await loadSnapshot(label, verbose)
      setLoading(false)
      return ok
    } catch (err) {
      pushLog('error', `${label}: ${String(err)}`)
      setLoading(false)
      return false
    }
  }, [applySnapshot, loadSnapshot, pushLog, scrapeRunId])

  useEffect(() => {
    try { localStorage.setItem('cluster-monitor:refresh-interval', refreshInterval) } catch { /* ignore */ }
  }, [refreshInterval])

  // Seed tables from Lakebase on mount
  useEffect(() => {
    loadSnapshot('Load snapshot', true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const ms = REFRESH_INTERVALS[refreshInterval]
    if (ms === null) return
    timerRef.current = setTimeout(async () => {
      // Auto-refresh only reloads Lakebase (does not start a new job each tick)
      setLoading(true)
      await loadSnapshot('auto-refresh', false)
      setLoading(false)
      scheduleNext()
    }, ms)
  }, [loadSnapshot, refreshInterval])

  useEffect(() => {
    scheduleNext()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval])

  const stopStream = useCallback(() => {
    abortRef.current = true
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLoading(false)
    pushLog('warning', 'Refresh stopped by user')
  }, [pushLog])

  /** Manual Refresh: trigger classic job + poll (falls back to reload). */
  const manualRefresh = useCallback(
    (label: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      triggerAndPoll(label, true).then(() => scheduleNext())
    },
    [scheduleNext, triggerAndPoll],
  )

  /** Phase buttons reload Lakebase only (job already scraped all types together). */
  const targetedRefresh = useCallback(
    (phase: Phase) => {
      setLoading(true)
      loadSnapshot(`Reload ${phase.replace('_', ' ')}`, true).finally(() => setLoading(false))
    },
    [loadSnapshot],
  )

  /** Row refresh: re-read snapshot (no live SDK). */
  const refreshCluster = useCallback(
    async (clusterId: string, workspace: string): Promise<boolean> => {
      try {
        const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
        const res = await fetch(`/api/clusters/${encodeURIComponent(clusterId)}${qs}`)
        if (!res.ok) {
          pushLog('error', `Cluster ${clusterId}: not in latest snapshot (HTTP ${res.status})`)
          return false
        }
        const updated = await res.json()
        setClusters(prev =>
          prev.map(c => (c.id === clusterId && c.workspace === workspace ? updated : c))
        )
        pushLog('info', `${workspace}/${updated.name}: ${updated.state} (from snapshot)`)
        return true
      } catch (err) {
        pushLog('error', `Cluster ${clusterId}: ${String(err)}`)
        return false
      }
    },
    [pushLog],
  )

  return {
    clusters,
    warehouses,
    pipelines,
    jobRuns,
    loading,
    lastRefresh,
    scrapeRunId,
    refreshInterval,
    setRefreshInterval,
    manualRefresh,
    targetedRefresh,
    stopStream,
    refreshCluster,
    phaseLastRefreshed,
    workspaceHosts,
    reloadWorkspaces,
    log,
    pushLog,
    clearLog,
    REFRESH_INTERVALS,
  }
}
