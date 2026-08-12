import { useState, useEffect, useCallback, useRef } from 'react'
import type { Cluster, Warehouse, Pipeline, JobRun, LogEntry, LogLevel } from '../types'

export const REFRESH_INTERVALS: Record<string, number | null> = {
  '30s': 30_000,
  '60s': 60_000,
  '2min': 120_000,
  '5min': 300_000,
  Off: null,
}

// SSE event shapes from /api/compute/stream
interface ProgressEvent    { type: 'progress';          message: string }
interface ClustersPage     { type: 'clusters_page';     workspace: string; page: number; count_so_far: number; items: Cluster[] }
interface ClustersDone     { type: 'clusters_done';     workspace: string; total: number }
interface WarehousesPage   { type: 'warehouses_page';   workspace: string; page: number; count_so_far: number; items: Warehouse[] }
interface WarehousesDone   { type: 'warehouses_done';   workspace: string; total: number }
interface PipelinesPage    { type: 'pipelines_page';    workspace: string; page: number; count_so_far: number; items: Pipeline[] }
interface PipelinesDone    { type: 'pipelines_done';    workspace: string; total: number }
interface JobRunsPage      { type: 'job_runs_page';     workspace: string; page: number; count_so_far: number; items: JobRun[] }
interface JobRunsDone      { type: 'job_runs_done';     workspace: string; total: number }
interface ErrorEvent        { type: 'error';            phase: string;     workspace: string; message: string }
interface SnapshotSaving   { type: 'snapshot_saving';  total: number }
interface DoneEvent        {
  type: 'done'
  total_clusters: number
  total_warehouses: number
  total_pipelines: number
  total_job_runs: number
}
export type Phase = 'clusters' | 'warehouses' | 'pipelines' | 'job_runs'

type StreamEvent =
  | ProgressEvent | ClustersPage | ClustersDone
  | WarehousesPage | WarehousesDone
  | PipelinesPage | PipelinesDone
  | JobRunsPage | JobRunsDone
  | ErrorEvent | SnapshotSaving | DoneEvent

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function entry(level: LogLevel, message: string): LogEntry {
  return { time: ts(), level, message }
}

export function useComputeData() {
  const [clusters, setClusters]       = useState<Cluster[]>([])
  const [warehouses, setWarehouses]   = useState<Warehouse[]>([])
  const [pipelines, setPipelines]     = useState<Pipeline[]>([])
  const [jobRuns, setJobRuns]         = useState<JobRun[]>([])
  const [loading, setLoading]         = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<string>(() => {
    try { return localStorage.getItem('cluster-monitor:refresh-interval') ?? 'Off' } catch { return 'Off' }
  })
  const [log, setLog] = useState<LogEntry[]>([])

  // Per-phase last-refresh timestamps (epoch ms) — used for button tooltips
  const [phaseLastRefreshed, setPhaseLastRefreshed] = useState<Record<Phase | 'all', number | null>>({
    clusters: null, warehouses: null, pipelines: null, job_runs: null, all: null,
  })

  // Workspace name → host URL map for deep-link construction
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

  /** Re-fetch the workspace list and update deep-link hosts. Call after saving workspace config. */
  const reloadWorkspaces = useCallback(() => { fetchWorkspaces() }, [fetchWorkspaces])

  function stampPhase(phase: Phase | 'all') {
    setPhaseLastRefreshed(prev => ({ ...prev, [phase]: Date.now() }))
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef    = useRef<EventSource | null>(null)

  const pushLog = useCallback((level: LogLevel, message: string) => {
    setLog(prev => [entry(level, message), ...prev].slice(0, 400))
  }, [])

  const clearLog = useCallback(() => setLog([]), [])

  // ── Stream fetch ──────────────────────────────────────────────────────────

  /** Build the SSE URL for a targeted phase fetch (always unfiltered). */
  function buildStreamUrl(phase?: Phase, workspace?: string): string {
    const p = new URLSearchParams()
    if (phase)     p.set('phases', phase)
    if (workspace) p.set('workspace', workspace)
    const qs = p.toString()
    return qs ? `/api/compute/stream?${qs}` : '/api/compute/stream'
  }

  const openStream = useCallback(
    (label: string, verbose: boolean, phase?: Phase, workspace?: string): Promise<boolean> => {
      return new Promise(resolve => {
        if (esRef.current) { esRef.current.close(); esRef.current = null }

        setLoading(true)
        // For targeted refreshes, only clear the relevant slice
        if (!phase) {
          setClusters([])
          setWarehouses([])
          setPipelines([])
          setJobRuns([])
        } else if (phase === 'clusters')   { setClusters([]) }
          else if (phase === 'warehouses') { setWarehouses([]) }
          else if (phase === 'pipelines')  { setPipelines([]) }
          else if (phase === 'job_runs')   { setJobRuns([]) }

        if (verbose) pushLog('info', `${label}: starting stream…`)

        const es = new EventSource(buildStreamUrl(phase, workspace))
        esRef.current = es
        let hadError = false

        es.onmessage = (ev: MessageEvent<string>) => {
          const msg = JSON.parse(ev.data) as StreamEvent

          switch (msg.type) {
            // ── progress ────────────────────────────────────────────────────
            case 'progress':
              if (verbose) pushLog('info', msg.message)
              break

            // ── clusters ────────────────────────────────────────────────────
            case 'clusters_page':
              setClusters(prev => [...prev, ...msg.items])
              if (verbose)
                pushLog('info',
                  `${msg.workspace} — clusters page ${msg.page}: ${msg.items.length} rows (${msg.count_so_far} so far)`)
              break

            case 'clusters_done':
              stampPhase('clusters')
              if (verbose)
                pushLog('success', `${msg.workspace} — clusters complete: ${msg.total}`)
              break

            // ── warehouses ──────────────────────────────────────────────────
            case 'warehouses_page':
              setWarehouses(prev => [...prev, ...msg.items])
              if (verbose)
                pushLog('info',
                  `${msg.workspace} — warehouses page ${msg.page}: ${msg.items.length} rows (${msg.count_so_far} so far)`)
              break

            case 'warehouses_done':
              stampPhase('warehouses')
              if (verbose)
                pushLog('success', `${msg.workspace} — warehouses complete: ${msg.total}`)
              break

            // ── DLT pipelines ────────────────────────────────────────────────
            case 'pipelines_page':
              setPipelines(prev => [...prev, ...msg.items])
              if (verbose)
                pushLog('info',
                  `${msg.workspace} — pipelines page ${msg.page}: ${msg.items.length} rows (${msg.count_so_far} so far)`)
              break

            case 'pipelines_done':
              stampPhase('pipelines')
              if (verbose)
                pushLog('success', `${msg.workspace} — pipelines complete: ${msg.total}`)
              break

            // ── active job runs ──────────────────────────────────────────────
            case 'job_runs_page':
              setJobRuns(prev => [...prev, ...msg.items])
              if (verbose)
                pushLog('info',
                  `${msg.workspace} — job runs page ${msg.page}: ${msg.items.length} rows (${msg.count_so_far} so far)`)
              break

            case 'job_runs_done':
              stampPhase('job_runs')
              if (verbose)
                pushLog('success', `${msg.workspace} — job runs complete: ${msg.total}`)
              break

            // ── error ────────────────────────────────────────────────────────
            case 'snapshot_saving':
              pushLog('info', `Saving snapshot (${msg.total} records)…`)
              break

            case 'error':
              hadError = true
              pushLog('error', `${msg.phase}/${msg.workspace}: ${msg.message}`)
              break

            // ── final summary ────────────────────────────────────────────────
            case 'done': {
              es.close()
              esRef.current = null
              setLoading(false)
              setLastRefresh(ts())
              stampPhase('all')
              const { total_clusters: tc, total_warehouses: tw,
                      total_pipelines: tp, total_job_runs: tj } = msg
              pushLog(
                hadError ? 'warning' : 'success',
                `${label} complete — ${tc} clusters, ${tw} warehouses, ` +
                `${tp} pipelines, ${tj} active job runs` +
                (hadError ? ' (some errors)' : ''),
              )
              resolve(!hadError)
              break
            }
          }
        }

        es.onerror = () => {
          hadError = true
          pushLog('error', `${label}: SSE connection error`)
          es.close()
          esRef.current = null
          setLoading(false)
          resolve(false)
        }
      })
    },
    [pushLog],
  )

  // Persist interval preference
  useEffect(() => {
    try { localStorage.setItem('cluster-monitor:refresh-interval', refreshInterval) } catch { /* ignore */ }
  }, [refreshInterval])

  // ── Seed tables from last stored snapshot on first mount ─────────────────

  useEffect(() => {
    async function loadSnapshot() {
      try {
        const res = await fetch('/api/snapshot/latest')
        if (!res.ok) return
        const data = await res.json()
        if (!data.available) return
        if (data.clusters?.length)   setClusters(data.clusters)
        if (data.warehouses?.length) setWarehouses(data.warehouses)
        if (data.pipelines?.length)  setPipelines(data.pipelines)
        if (data.job_runs?.length)   setJobRuns(data.job_runs)
        if (data.snapshot_time) {
          const d = new Date(data.snapshot_time)
          const label = isNaN(d.getTime())
            ? data.snapshot_time
            : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          setLastRefresh(`snapshot ${label}`)
          pushLog('info', `Loaded last snapshot (${label}) — click Refresh for live data`)
        }
      } catch {
        // History not configured or unavailable — silent fail
      }
    }
    loadSnapshot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-refresh scheduling ───────────────────────────────────────────────

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const ms = REFRESH_INTERVALS[refreshInterval]
    if (ms === null) return
    timerRef.current = setTimeout(async () => {
      await openStream('auto-refresh', false)
      scheduleNext()
    }, ms)
  }, [openStream, refreshInterval])

  useEffect(() => {
    // No automatic load on mount — user clicks Refresh to pull data.
    // If an auto-refresh interval is active, schedule the first tick normally
    // so it fires after the configured delay (not immediately).
    scheduleNext()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (esRef.current) { esRef.current.close(); esRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInterval])

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLoading(false)
    pushLog('warning', 'Refresh stopped by user')
  }, [pushLog])

  const manualRefresh = useCallback(
    (label: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      openStream(label, true).then(() => scheduleNext())
    },
    [openStream, scheduleNext],
  )

  /** Refresh a single resource type — always unfiltered; display filters apply client-side. */
  const targetedRefresh = useCallback(
    (phase: Phase) => {
      openStream(`Refresh ${phase.replace('_', ' ')}`, true, phase)
      // Don't reschedule the full auto-refresh timer — that continues independently
    },
    [openStream],
  )

  /**
   * Fetch the latest state of one cluster and patch it in-place.
   * Returns true on success, false on error.
   */
  const refreshCluster = useCallback(
    async (clusterId: string, workspace: string): Promise<boolean> => {
      try {
        const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
        const res = await fetch(`/api/clusters/${encodeURIComponent(clusterId)}${qs}`)
        if (!res.ok) {
          pushLog('error', `Refresh cluster ${clusterId}: HTTP ${res.status}`)
          return false
        }
        const updated = await res.json()
        setClusters(prev =>
          prev.map(c => (c.id === clusterId && c.workspace === workspace ? updated : c))
        )
        pushLog('success', `${workspace}/${updated.name}: ${updated.state}`)
        return true
      } catch (err) {
        pushLog('error', `Refresh cluster ${clusterId}: ${String(err)}`)
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
