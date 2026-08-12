import { useState, useEffect, useCallback } from 'react'
import { useComputeData } from './hooks/useComputeData'
import { useDarkMode } from './hooks/useDarkMode'
import { SummaryCards } from './components/SummaryCards'
import { FilterBar } from './components/FilterBar'
import { ClusterTable } from './components/ClusterTable'
import { WarehouseTable } from './components/WarehouseTable'
import { PipelineTable } from './components/PipelineTable'
import { JobRunsTable } from './components/JobRunsTable'
import { TagBreakdown } from './components/TagBreakdown'
import { HistoryTab } from './components/HistoryTab'
import { SettingsPage } from './components/SettingsPage'
import type { SettingsTab } from './components/SettingsPage'
import { ActivityLog } from './components/ActivityLog'
import { NeedsAttentionTab, attentionCount } from './components/NeedsAttentionTab'
import { AboutPage } from './components/AboutPage'
import type { Filters } from './types'

/** Human-readable relative time for a past epoch-ms timestamp. */
function relativeTime(epochMs: number | null): string {
  if (epochMs === null) return 'Never'
  const secs = Math.floor((Date.now() - epochMs) / 1000)
  if (secs < 5)  return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

type Tab = 'interactive' | 'jobs' | 'warehouses' | 'pipelines' | 'job_runs' | 'attention' | 'history' | 'tags'
type Overlay = 'settings' | 'about'

const VALID_SETTINGS_TABS = new Set<SettingsTab>(['general', 'authentication', 'workspaces'])

function settingsTabFromHash(hash: string): SettingsTab {
  // e.g. "settings/authentication" → "authentication"
  const sub = hash.split('/')[1] as SettingsTab
  return VALID_SETTINGS_TABS.has(sub) ? sub : 'general'
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'attention',   label: 'Needs Attention' },
  { id: 'interactive', label: 'Interactive Clusters' },
  { id: 'jobs',        label: 'Job Clusters' },
  { id: 'warehouses',  label: 'SQL Warehouses' },
  { id: 'pipelines',   label: 'DLT Pipelines' },
  { id: 'job_runs',    label: 'Active Job Runs' },
  { id: 'history',     label: 'History' },
  { id: 'tags',        label: 'Tag Breakdown' },
]

export default function App() {
  const [dark, setDark] = useDarkMode()
  const [bundleTarget,      setBundleTarget]      = useState<string>('')
  const [workspaceHost,     setWorkspaceHost]     = useState<string>('')
  const [lakebaseProjectId, setLakebaseProjectId] = useState<string>('')

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : {})
      .then((d: Record<string, unknown>) => {
        setBundleTarget((d.bundle_target as string) ?? '')
        setWorkspaceHost((d.workspace_host as string) ?? '')
        setLakebaseProjectId((d.lakebase_project_id as string) ?? '')
      })
      .catch(() => {})
  }, [])

  const {
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
  } = useComputeData()

  const VALID_TABS     = new Set<Tab>(['interactive','jobs','warehouses','pipelines','job_runs','attention','history','tags'])
  const VALID_OVERLAYS = new Set<Overlay>(['settings','about'])

  function parseHash() {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'settings' || hash.startsWith('settings/')) {
      return { overlay: 'settings' as Overlay, tab: 'attention' as Tab, settingsTab: settingsTabFromHash(hash) }
    }
    if (hash === 'about') {
      return { overlay: 'about' as Overlay, tab: 'attention' as Tab, settingsTab: 'general' as SettingsTab }
    }
    return { overlay: null, tab: VALID_TABS.has(hash as Tab) ? (hash as Tab) : 'attention' as Tab, settingsTab: 'general' as SettingsTab }
  }

  const initial = parseHash()
  const [activeTab,     setActiveTab]     = useState<Tab>(initial.tab)
  const [overlay,       setOverlay]       = useState<Overlay | null>(initial.overlay)
  const [settingsTab,   setSettingsTab]   = useState<SettingsTab>(initial.settingsTab)
  const [settingsDirty, setSettingsDirty] = useState(false)

  // Confirm helper — returns true if it's safe to leave Settings
  function confirmLeaveSettings(): boolean {
    if (!settingsDirty) return true
    return window.confirm('You have unsaved workspace changes. Leave without saving?')
  }

  // Sync hash → state on browser navigation
  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash()
      setOverlay(parsed.overlay)
      setSettingsTab(parsed.settingsTab)
      if (!parsed.overlay) setActiveTab(parsed.tab)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Close overlay on Escape (guarded when dirty)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overlay === 'settings' && !confirmLeaveSettings()) return
        closeOverlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, settingsDirty])

  // Warn on browser-level navigation (refresh / close tab) when dirty
  useEffect(() => {
    if (!settingsDirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [settingsDirty])

  function navigateTab(tab: Tab) {
    if (overlay === 'settings' && !confirmLeaveSettings()) return
    window.location.hash = tab
    setActiveTab(tab)
    setOverlay(null)
    setSettingsDirty(false)
  }
  function openOverlay(ov: Overlay, stab?: SettingsTab) {
    const hash = ov === 'settings' ? `settings/${stab ?? settingsTab}` : ov
    window.location.hash = hash
    setOverlay(ov)
    if (stab) setSettingsTab(stab)
  }
  function closeOverlay() {
    setOverlay(null)
    setSettingsDirty(false)
    window.location.hash = activeTab
  }
  function toggleOverlay(ov: Overlay) {
    if (overlay === 'settings' && ov !== 'settings' && !confirmLeaveSettings()) return
    if (overlay === ov) {
      if (overlay === 'settings' && !confirmLeaveSettings()) return
      closeOverlay()
    } else {
      openOverlay(ov)
    }
  }
  const handleSettingsTabChange = useCallback((t: SettingsTab) => {
    setSettingsTab(t)
    window.location.hash = `settings/${t}`
  }, [])
  const [filters, setFilters] = useState<Filters>({
    workspace: '',
    state: '',
    tagKey: '',
    tagValue: '',
  })

  // DLT pipeline clusters are surfaced in the Pipelines tab — exclude them here
  const interactive = clusters.filter(c => !c.is_job_cluster && !c.is_pipeline_cluster)
  const jobs        = clusters.filter(c => c.is_job_cluster)

  function handleFilterChange(f: Filters) {
    setFilters(f)
    const parts = [
      f.tagKey && `tag:${f.tagKey}${f.tagValue ? `=${f.tagValue}` : ''}`,
      f.workspace && `workspace:${f.workspace}`,
      f.state && `state:${f.state}`,
    ].filter(Boolean)
    pushLog('info', `Filters → ${parts.length ? parts.join(', ') : '(cleared)'}`)
  }

  // Tabs that don't use tag filters
  const showTagFilters = !['pipelines', 'job_runs', 'history'].includes(activeTab)

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
      {/* Floating activity log */}
      <ActivityLog entries={log} onClear={clearLog} />

      {/* Dev environment banner */}
      {bundleTarget === 'dev' && (
        <div className="w-full bg-amber-400 dark:bg-amber-500 text-amber-900 dark:text-amber-950 text-xs font-semibold text-center py-1 px-4 tracking-wide select-none">
          ⚠ DEVELOPMENT — this workspace reflects dev data and config
        </div>
      )}

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-dbx-red" />
            Cluster &amp; Warehouse Monitor
          </h1>
          <p className="text-xs text-gray-400">
            Classic-job snapshots across workspaces (Lakebase read-only UI)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh status */}
          {lastRefresh && !loading && (
            <span className="text-xs text-gray-400">Snapshot {lastRefresh}</span>
          )}
          {loading && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-dbx-red animate-pulse" />
              Scraping / loading…
            </span>
          )}

          {/* Refresh All / Stop */}
          {loading ? (
            <button
              className="btn text-xs py-1 px-2.5 flex items-center gap-1.5 border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              onClick={stopStream}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Stop
            </button>
          ) : (
            <button
              className="btn-primary text-xs py-1 px-2.5"
              title={`Last snapshot: ${relativeTime(phaseLastRefreshed['all'])}. Triggers classic scrape job.`}
              onClick={() => manualRefresh('Refresh All')}
            >
              ↺ Refresh All
            </button>
          )}

          {/* Divider */}
          <span className="w-px h-5 bg-gray-200 dark:bg-gray-600" />

          {/* Auto-refresh */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 dark:text-gray-400">Auto-refresh</label>
            <select
              className="input-select"
              value={refreshInterval}
              onChange={e => {
                setRefreshInterval(e.target.value)
                pushLog('info', `Auto-refresh → ${e.target.value}`)
              }}
            >
              {Object.keys(REFRESH_INTERVALS).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          {/* Divider */}
          <span className="w-px h-5 bg-gray-200 dark:bg-gray-600" />

          {/* Settings & About */}
          <button
            onClick={() => toggleOverlay('settings')}
            className={`btn-outline text-xs py-1 px-2.5 ${overlay === 'settings' ? 'border-dbx-red text-dbx-red bg-red-50 dark:bg-red-900/20' : ''}`}
            title="Settings"
          >
            ⚙ Settings
          </button>
          <button
            onClick={() => toggleOverlay('about')}
            className={`btn-outline text-xs py-1 px-2.5 ${overlay === 'about' ? 'border-dbx-red text-dbx-red bg-red-50 dark:bg-red-900/20' : ''}`}
            title="About"
          >
            ℹ About
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="btn-outline w-8 h-8 p-0 flex items-center justify-center rounded-full"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.22 1.78a1 1 0 011.415 1.415l-.707.707a1 1 0 11-1.415-1.415l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zm-2.78 4.22a1 1 0 010 1.415l-.707.707a1 1 0 11-1.415-1.415l.707-.707a1 1 0 011.415 0zM10 16a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm-4.22-1.78a1 1 0 010 1.415l-.707.707A1 1 0 013.66 14.93l.707-.707a1 1 0 011.415 0zM4 10a1 1 0 01-1 1H2a1 1 0 110-2h1a1 1 0 011 1zm1.78-4.22a1 1 0 010-1.415l.707-.707A1 1 0 117.9 5.07l-.707.707a1 1 0 01-1.415 0zM10 7a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Full-screen overlay: Settings / About ─────────────────────────── */}
      {overlay && (
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
          {/* Overlay title bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {overlay === 'settings' ? (
                <>
                  ⚙ Settings
                  <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                    #{settingsTab}
                  </span>
                </>
              ) : 'ℹ About'}
            </h2>
            <button
              onClick={() => { if (overlay === 'settings' && !confirmLeaveSettings()) return; closeOverlay() }}
              className="btn-outline w-7 h-7 p-0 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title="Close (Esc)"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M1 1l12 12M13 1L1 13" />
              </svg>
            </button>
          </div>

          {/* Overlay scrollable content */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {overlay === 'settings' && (
              <SettingsPage
                reloadWorkspaces={reloadWorkspaces}
                tab={settingsTab}
                onTabChange={handleSettingsTabChange}
                onDirtyChange={setSettingsDirty}
                pushLog={pushLog}
              />
            )}
            {overlay === 'about' && <AboutPage workspaceHost={workspaceHost} lakebaseProjectId={lakebaseProjectId} />}
          </div>
        </div>
      )}

      {/* ── Main dashboard (hidden while overlay is open) ─────────────────── */}
      {!overlay && (
        <main className="px-6 py-4 space-y-4 max-w-screen-2xl mx-auto">
          {/* Summary cards */}
          <SummaryCards
            clusters={clusters}
            warehouses={warehouses}
            pipelines={pipelines}
            jobRuns={jobRuns}
            onNavigate={tab => navigateTab(tab as Tab)}
          />

          {/* Empty-state prompt — shown before first refresh */}
          {!loading && !lastRefresh && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-8 text-center">
              <p className="text-gray-500 text-sm font-medium mb-1">No snapshot loaded yet</p>
              <p className="text-gray-400 text-xs">
                Click <span className="font-semibold text-gray-600">↺ Refresh All</span> to trigger the
                classic scrape job, or wait for the scheduled 5-minute run. Configure workspaces under Settings first.
              </p>
            </div>
          )}

          {/* Filters — only for tabs that use tag/state/workspace filtering */}
          {showTagFilters && (
            <FilterBar
              clusters={clusters}
              warehouses={warehouses}
              filters={filters}
              onChange={handleFilterChange}
            />
          )}

          {/* Tabs */}
          <div className="card">
            {/* Per-resource refresh buttons */}
            <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b border-gray-100 bg-gray-50/60 dark:bg-slate-800/60 dark:border-slate-700">
              <span className="text-xs text-gray-400 mr-0.5 select-none">Refresh:</span>
              {(
                [
                  { phase: 'clusters',   label: 'Clusters',   count: clusters.length   },
                  { phase: 'warehouses', label: 'Warehouses', count: warehouses.length },
                  { phase: 'pipelines',  label: 'Pipelines',  count: pipelines.length  },
                  { phase: 'job_runs',   label: 'Job Runs',   count: jobRuns.length    },
                ] as const
              ).map(({ phase, label, count }) => (
                <button
                  key={phase}
                  className="btn-outline text-xs py-0.5 px-2 flex items-center gap-1"
                  disabled={loading}
                  title={`Last refreshed: ${relativeTime(phaseLastRefreshed[phase])}`}
                  onClick={() => targetedRefresh(phase)}
                >
                  ↺ {label}
                  {count > 0 && (
                    <span className="text-gray-400 font-normal">({count})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab bar */}
            <div className="border-b border-gray-200 overflow-x-auto">
              <nav className="flex -mb-px px-4" aria-label="Tabs">
                {TABS.map(t => {
                  const isAttention = t.id === 'attention'
                  const badgeCount  = isAttention
                    ? attentionCount(clusters, warehouses, pipelines, jobRuns)
                    : 0
                  return (
                    <a
                      key={t.id}
                      href={`#${t.id}`}
                      className={`tab-btn ${activeTab === t.id ? 'tab-btn-active' : 'tab-btn-inactive'} relative`}
                      onClick={e => { e.preventDefault(); navigateTab(t.id) }}
                    >
                      {t.label}
                      {isAttention && badgeCount > 0 && (
                        <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                          {badgeCount}
                        </span>
                      )}
                    </a>
                  )
                })}
              </nav>
            </div>

            {/* Tab content */}
            <div className="p-4">
              {activeTab === 'interactive' && (
                <ClusterTable
                  clusters={interactive}
                  filters={filters}
                  loading={loading}
                  onRefreshRow={refreshCluster}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'jobs' && (
                <ClusterTable
                  clusters={jobs}
                  filters={filters}
                  loading={loading}
                  onRefreshRow={refreshCluster}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'warehouses' && (
                <WarehouseTable
                  warehouses={warehouses}
                  filters={filters}
                  loading={loading}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'pipelines' && (
                <PipelineTable
                  pipelines={pipelines}
                  workspaceFilter={filters.workspace}
                  stateFilter={filters.state}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'job_runs' && (
                <JobRunsTable
                  jobRuns={jobRuns}
                  workspaceFilter={filters.workspace}
                  stateFilter={filters.state}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'history'   && <HistoryTab onLog={pushLog} />}
              {activeTab === 'attention' && (
                <NeedsAttentionTab
                  clusters={clusters}
                  warehouses={warehouses}
                  pipelines={pipelines}
                  jobRuns={jobRuns}
                  workspaceHosts={workspaceHosts}
                />
              )}
              {activeTab === 'tags' && (
                <TagBreakdown clusters={clusters} warehouses={warehouses} />
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  )
}
