import { useEffect, useState, useCallback } from 'react'
import type { AppSettings, AccountSpSettings, WorkspaceConfig, TestResult, LogLevel } from '../types'
import { useDarkMode } from '../hooks/useDarkMode'

// ── Small shared UI primitives ────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  )
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
      {children}
    </label>
  )
}

function TextInput({ id, value, onChange, placeholder, mono, type = 'text', disabled }: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  type?: 'text' | 'password'
  disabled?: boolean
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={[
        'w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm',
        'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100',
        'placeholder-gray-400 dark:placeholder-gray-500',
        'focus:outline-none focus:ring-2 focus:ring-dbx-red focus:border-transparent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        mono ? 'font-mono' : '',
      ].join(' ')}
    />
  )
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'error'

function TestBadge({ status, result }: { status: TestStatus; result: TestResult | null }) {
  if (status === 'idle') return null
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Testing…
      </span>
    )
  }
  const ok = status === 'ok'
  return (
    <div className={`rounded-lg px-3 py-2 text-xs ${ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
      <span className="font-semibold">{ok ? '✓ Connected' : '✗ Failed'}</span>
      {' — '}
      {result?.message}
      {ok && result?.latency_ms != null && (
        <span className="ml-1 text-green-500">({result.latency_ms} ms)</span>
      )}
    </div>
  )
}

function ValidateBadge({ status, msg }: { status: TestStatus; msg: string }) {
  const [expanded, setExpanded] = useState(false)
  if (status === 'idle') return null
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Testing…
      </span>
    )
  }
  const ok = status === 'ok'
  // Split on ' — ' so we can show the primary error first and the checklist on expand
  const dashIdx = msg.indexOf(' — ')
  const primary = dashIdx > -1 ? msg.slice(0, dashIdx) : msg
  const detail  = dashIdx > -1 ? msg.slice(dashIdx + 3) : ''
  return (
    <div className="text-xs space-y-1 max-w-prose">
      <span className={`font-medium ${ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {ok ? '✓' : '✗'} {primary}
        {detail && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-1.5 underline font-normal opacity-70 hover:opacity-100"
          >
            {expanded ? 'less' : 'details'}
          </button>
        )}
      </span>
      {expanded && detail && (
        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">{detail}</p>
      )}
    </div>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-dbx-red focus:ring-offset-1',
        enabled ? 'bg-dbx-red' : 'bg-gray-200 dark:bg-gray-600',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out',
          enabled ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

function SaveBanner({ status, errorMsg }: { status: 'idle' | 'saving' | 'saved' | 'error'; errorMsg?: string }) {
  if (status === 'idle') return null
  const map = {
    saving: { bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300',     msg: 'Saving…' },
    saved:  { bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300', msg: '✓ Settings saved — backend reloaded.' },
    error:  { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300',             msg: '✗ Save failed.' },
  }
  const { bg, msg } = map[status]
  return (
    <div className={`rounded-lg border px-4 py-2.5 text-sm ${bg}`}>
      <span className="font-medium">{msg}</span>
      {status === 'error' && errorMsg && (
        <span className="ml-1.5 font-mono text-xs opacity-80">{errorMsg}</span>
      )}
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────

export type SettingsTab = 'general' | 'authentication' | 'workspaces'

function TabBar({ active, onChange, wsDirty }: {
  active: SettingsTab
  onChange: (t: SettingsTab) => void
  wsDirty?: boolean
}) {
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general',        label: 'General' },
    { id: 'authentication', label: 'Authentication' },
    { id: 'workspaces',     label: 'Workspaces' },
  ]
  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
            active === t.id
              ? 'border-dbx-red text-dbx-red dark:text-red-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600',
          ].join(' ')}
        >
          {t.label}
          {t.id === 'workspaces' && wsDirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"
              title="Unsaved workspace changes"
            />
          )}
        </button>
      ))}
    </div>
  )
}


// ── Workspace permission badge ────────────────────────────────────────────

type WsPermStatus = 'unchecked' | 'checking' | 'admin' | 'limited' | 'no-access' | 'error'

function PermBadge({ status, error }: { status: WsPermStatus; error?: string }) {
  if (status === 'unchecked') return null
  if (status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
        <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Checking
      </span>
    )
  }
  if (status === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" title="SP has workspace admin access">
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
        </svg>
        Admin
      </span>
    )
  }
  if (status === 'limited') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400" title="SP can access but is not an admin — limited visibility">
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        Limited
      </span>
    )
  }
  if (status === 'no-access') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400" title={error || 'SP is not a member of this workspace'}>
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524L13.477 14.89zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
        </svg>
        No access
      </span>
    )
  }
  // error
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" title={error}>
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      Error
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  lakebase:                 { endpoint: '', database: 'databricks_postgres' },
  json_storage:             { enabled: false, path: '' },
  account_sp:               { account_id: '', client_id: '', client_secret: '' },
  workspaces:               [],
  request_timeout_seconds:  30,
}

const EMPTY_SP: AccountSpSettings = { account_id: '', client_id: '', client_secret: '' }

export function SettingsPage({
  reloadWorkspaces,
  tab,
  onTabChange,
  onDirtyChange,
  pushLog,
}: {
  reloadWorkspaces?: () => void
  tab?: SettingsTab
  onTabChange?: (t: SettingsTab) => void
  onDirtyChange?: (dirty: boolean) => void
  pushLog?: (level: LogLevel, message: string) => void
}) {
  /** Convenience wrapper — no-op if pushLog prop not provided */
  const log = useCallback((level: LogLevel, msg: string) => pushLog?.(level, msg), [pushLog])

  const [dark, setDark] = useDarkMode()
  const [internalTab, setInternalTab] = useState<SettingsTab>('general')
  const activeTab = tab ?? internalTab
  function setActiveTab(t: SettingsTab) {
    setInternalTab(t)
    onTabChange?.(t)
  }
  const [settings, setSettings]   = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Lakebase test state
  const [lbTestStatus, setLbTestStatus] = useState<TestStatus>('idle')
  const [lbTestResult, setLbTestResult] = useState<TestResult | null>(null)

  // Save state
  const [saveStatus,   setSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveErrorMsg, setSaveErrorMsg] = useState<string>('')

  // ── Workspace management ─────────────────────────────────────────────────
  const [workspaces,    setWorkspaces]    = useState<WorkspaceConfig[]>([])
  const [wsDiscovering, setWsDiscovering] = useState(false)
  const [wsDiscoverMsg, setWsDiscoverMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [wsSaveStatus,  setWsSaveStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [wsDirty,       setWsDirty]       = useState(false)
  const [wsSearch,        setWsSearch]        = useState('')
  const [wsRegion,        setWsRegion]        = useState('')
  const [wsShowSelected,  setWsShowSelected]  = useState(true)

  useEffect(() => { onDirtyChange?.(wsDirty) }, [wsDirty, onDirtyChange])

  // ── Workspace permission state ────────────────────────────────────────────
  type WsPerm = { status: WsPermStatus; error?: string }
  const [wsPerms,         setWsPerms]         = useState<Record<string, WsPerm>>({})
  const [wsChecking,      setWsChecking]       = useState(false)
  const [wsGranting,      setWsGranting]       = useState<Record<string, boolean>>({}) // host → granting

  // ── Validation state ──────────────────────────────────────────────────────
  const [spValidate, setSpValidate] = useState<{ status: TestStatus; msg: string }>({ status: 'idle', msg: '' })

  // ── Load settings on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((d: AppSettings) => {
        setSettings(d)
        if (d.workspaces?.length) setWorkspaces(d.workspaces)
      })
      .catch(err => setLoadError(String(err)))
    fetch('/api/workspaces')
      .then(r => r.ok ? r.json() : [])
      .then((list: WorkspaceConfig[]) => { if (list.length) { setWorkspaces(list); setWsDirty(false) } })
      .catch(() => {})
  }, [])

  // ── Field helpers ─────────────────────────────────────────────────────────
  function setLakebase(patch: Partial<AppSettings['lakebase']>) {
    setSettings(s => ({ ...s, lakebase: { ...s.lakebase, ...patch } }))
    setLbTestStatus('idle')
    setLbTestResult(null)
  }

  function setAccountSp(patch: Partial<AccountSpSettings>) {
    setSettings(s => ({ ...s, account_sp: { ...(s.account_sp ?? EMPTY_SP), ...patch } }))
  }


  // ── Test connection ───────────────────────────────────────────────────────
  async function handleTestLakebase() {
    setLbTestStatus('testing')
    setLbTestResult(null)
    log('info', 'Settings → Testing Lakebase connection…')
    try {
      const res = await fetch('/api/settings/test-lakebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: settings.lakebase.endpoint, database: settings.lakebase.database }),
      })
      const data: TestResult = await res.json()
      setLbTestResult(data)
      setLbTestStatus(data.ok ? 'ok' : 'error')
      if (data.ok) {
        log('success', `Settings → Lakebase connected${data.latency_ms != null ? ` (${data.latency_ms} ms)` : ''}`)
      } else {
        log('error', `Settings → Lakebase connection failed: ${data.message}`)
      }
    } catch (err) {
      setLbTestResult({ ok: false, message: String(err) })
      setLbTestStatus('error')
      log('error', `Settings → Lakebase test error: ${err}`)
    }
  }

  // ── Save main settings ────────────────────────────────────────────────────
  async function handleSave() {
    setSaveStatus('saving')
    setSaveErrorMsg('')
    log('info', 'Settings → Saving general settings…')
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body.error)  detail = body.error
          else if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
        } catch { /* body not JSON */ }
        throw new Error(detail)
      }
      setSaveStatus('saved')
      setSaveErrorMsg('')
      log('success', 'Settings → General settings saved')
      setTimeout(() => setSaveStatus('idle'), 4000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSaveErrorMsg(msg)
      setSaveStatus('error')
      log('error', `Settings → Save failed: ${msg}`)
      setTimeout(() => { setSaveStatus('idle'); setSaveErrorMsg('') }, 8000)
    }
  }

  // ── Validate credentials ──────────────────────────────────────────────────
  async function handleValidateSp() {
    setSpValidate({ status: 'testing', msg: '' })
    log('info', 'Settings → Validating service principal credentials…')
    try {
      const res = await fetch('/api/auth/validate/sp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id:    settings.account_sp?.account_id ?? '',
          client_id:     settings.account_sp?.client_id ?? '',
          client_secret: settings.account_sp?.client_secret ?? '',
        }),
      })
      const data = await res.json()
      setSpValidate({ status: data.ok ? 'ok' : 'error', msg: data.message })
      if (data.ok) {
        log('success', `Settings → SP valid: ${data.message}`)
      } else {
        log('error', `Settings → SP validation failed: ${data.message}`)
      }
    } catch (err) {
      setSpValidate({ status: 'error', msg: String(err) })
      log('error', `Settings → SP validation error: ${err}`)
    }
  }

  // ── Permission check ──────────────────────────────────────────────────────
  const handleCheckPermissions = useCallback(async (hosts: string[]) => {
    if (!hosts.length) return
    setWsChecking(true)
    log('info', `Settings → Checking SP permissions on ${hosts.length} workspace${hosts.length !== 1 ? 's' : ''}…`)
    setWsPerms(prev => {
      const next = { ...prev }
      hosts.forEach(h => { next[h] = { status: 'checking' } })
      return next
    })
    // Give the backend (timeout + 10s buffer) to respond, then abort client-side.
    const timeoutMs = ((settings.request_timeout_seconds ?? 30) + 15) * 1000
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res  = await fetch('/api/workspaces/check-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts }),
        signal: controller.signal,
      })
      clearTimeout(abortTimer)
      const data = await res.json() as { results: Record<string, { accessible: boolean; is_admin: boolean; error?: string }>; error?: string }
      if (!res.ok || data.error) {
        const errMsg = data.error ?? 'Check failed'
        setWsPerms(prev => {
          const next = { ...prev }
          hosts.forEach(h => { next[h] = { status: 'error', error: errMsg } })
          return next
        })
        log('error', `Settings → Permission check failed: ${errMsg}`)
        return
      }
      // Build updated perms and collect a summary for the log
      const permsUpdate: Record<string, { status: WsPermStatus; error?: string }> = {}
      let adminCount = 0, limitedCount = 0, noAccessCount = 0
      const wsNameFor = (host: string) => workspaces.find(w => w.host === host)?.name ?? host
      Object.entries(data.results).forEach(([host, r]) => {
        let status: WsPermStatus
        if (!r.accessible) { status = 'no-access'; noAccessCount++ }
        else if (r.is_admin) { status = 'admin'; adminCount++ }
        else { status = 'limited'; limitedCount++ }
        permsUpdate[host] = { status, error: r.error }
        // Per-workspace detail line
        const icon = status === 'admin' ? '✓' : status === 'limited' ? '⚠' : '✗'
        const label = status === 'admin' ? 'admin' : status === 'limited' ? 'limited (not admin)' : 'no access'
        const lvl: LogLevel = status === 'admin' ? 'success' : status === 'limited' ? 'warning' : 'error'
        log(lvl, `Settings → ${wsNameFor(host)}: ${icon} ${label}${r.error ? ` — ${r.error}` : ''}`)
      })
      setWsPerms(prev => ({ ...prev, ...permsUpdate }))
      // Summary
      const parts: string[] = []
      if (adminCount)   parts.push(`${adminCount} admin`)
      if (limitedCount) parts.push(`${limitedCount} limited`)
      if (noAccessCount) parts.push(`${noAccessCount} no access`)
      const summaryLevel: LogLevel = noAccessCount > 0 || limitedCount > 0 ? 'warning' : 'success'
      log(summaryLevel, `Settings → Permission check complete: ${parts.join(', ')}`)
    } catch (err) {
      clearTimeout(abortTimer)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const errMsg = isAbort
        ? `Client-side timeout after ${timeoutMs / 1000}s — try increasing the request timeout in General settings`
        : String(err)
      setWsPerms(prev => {
        const next = { ...prev }
        hosts.forEach(h => { next[h] = { status: 'error', error: errMsg } })
        return next
      })
      log('error', `Settings → Permission check ${isAbort ? 'timed out' : 'error'}: ${errMsg}`)
    } finally {
      setWsChecking(false)
    }
  }, [log, workspaces, settings])

  // ── Grant admin ───────────────────────────────────────────────────────────
  const handleGrantAdmin = useCallback(async (ws: WorkspaceConfig) => {
    if (!ws.workspace_id) {
      const errMsg = 'No workspace ID — re-run Discover to populate it'
      setWsPerms(prev => ({ ...prev, [ws.host]: { status: 'error', error: errMsg } }))
      log('error', `Settings → Grant admin failed for ${ws.name}: ${errMsg}`)
      return
    }
    setWsGranting(prev => ({ ...prev, [ws.host]: true }))
    setWsPerms(prev => ({ ...prev, [ws.host]: { status: 'checking' } }))
    log('info', `Settings → Granting workspace admin to SP on ${ws.name}…`)
    try {
      const res  = await fetch('/api/workspaces/grant-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_ids: [ws.workspace_id] }),
      })
      const data = await res.json() as { results: Record<string, { success: boolean; error?: string }>; error?: string }
      if (!res.ok || data.error) {
        const errMsg = data.error ?? 'Grant failed'
        setWsPerms(prev => ({ ...prev, [ws.host]: { status: 'error', error: errMsg } }))
        log('error', `Settings → Grant admin failed for ${ws.name}: ${errMsg}`)
        return
      }
      const r = data.results[String(ws.workspace_id)]
      if (r?.success) {
        log('success', `Settings → Admin granted on ${ws.name} — re-checking to confirm…`)
        await handleCheckPermissions([ws.host])
      } else {
        const errMsg = r?.error ?? 'Grant failed'
        setWsPerms(prev => ({ ...prev, [ws.host]: { status: 'error', error: errMsg } }))
        log('error', `Settings → Grant admin failed for ${ws.name}: ${errMsg}`)
      }
    } catch (err) {
      setWsPerms(prev => ({ ...prev, [ws.host]: { status: 'error', error: String(err) } }))
      log('error', `Settings → Grant admin error for ${ws.name}: ${err}`)
    } finally {
      setWsGranting(prev => ({ ...prev, [ws.host]: false }))
    }
  }, [handleCheckPermissions, log])

  // ── Discover workspaces ───────────────────────────────────────────────────
  const handleDiscover = useCallback(async () => {
    setWsDiscovering(true)
    setWsDiscoverMsg(null)
    log('info', 'Settings → Discovering workspaces from account…')
    try {
      const res  = await fetch('/api/workspaces/discover')
      const data = await res.json() as { ok: boolean; workspaces: WorkspaceConfig[]; message?: string; error?: string }
      if (!res.ok || !data.ok) {
        const errMsg = data.error || 'Discovery failed'
        setWsDiscoverMsg({ ok: false, text: errMsg })
        log('error', `Settings → Workspace discovery failed: ${errMsg}`)
        return
      }
      setWorkspaces(prev => {
        const prevByHost: Record<string, WorkspaceConfig> = {}
        prev.forEach(w => { prevByHost[w.host.replace(/\/?$/, '')] = w })
        return (data.workspaces || []).map(w => {
          const existing = prevByHost[w.host.replace(/\/?$/, '')]
          return { ...w, enabled: w.current ? true : (existing?.enabled ?? true) }
        })
      })
      setWsDirty(true)
      const count = data.workspaces?.length ?? 0
      const msg = data.message || `Found ${count} workspace${count !== 1 ? 's' : ''}`
      setWsDiscoverMsg({ ok: true, text: msg })
      log('success', `Settings → Workspace discovery complete: ${msg}`)
    } catch (err) {
      setWsDiscoverMsg({ ok: false, text: String(err) })
      log('error', `Settings → Workspace discovery error: ${err}`)
    } finally {
      setWsDiscovering(false)
    }
  }, [log])

  // ── Save workspaces ───────────────────────────────────────────────────────
  async function handleSaveWorkspaces() {
    setWsSaveStatus('saving')
    const enabled = workspaces.filter(w => w.enabled).length
    log('info', `Settings → Saving workspace config (${enabled} of ${workspaces.length} enabled)…`)
    try {
      const res = await fetch('/api/workspaces/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaces }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setWsSaveStatus('saved')
      setWsDirty(false)
      reloadWorkspaces?.()
      log('success', `Settings → Workspace config saved — ${enabled} workspace${enabled !== 1 ? 's' : ''} will be monitored`)
      setTimeout(() => setWsSaveStatus('idle'), 4000)
    } catch (err) {
      setWsSaveStatus('error')
      log('error', `Settings → Workspace config save failed: ${err}`)
      setTimeout(() => setWsSaveStatus('idle'), 6000)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasAccountSp = !!(settings.account_sp?.account_id || settings.account_sp?.client_id || settings.account_sp?.client_secret)
  const lbActive = !!settings.lakebase.endpoint

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        Could not load settings: {loadError}
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <TabBar active={activeTab} onChange={setActiveTab} wsDirty={wsDirty} />

      {/* ─────────────────────── GENERAL TAB ──────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-6">

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Active history backend:</span>
            {lbActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Lakebase
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> None — history disabled
              </span>
            )}
          </div>

          <SectionCard
            title="Lakebase Database"
            subtitle="Connect to an autoscaling Lakebase project in this workspace. The app authenticates via its service principal — no password required."
          >
            <div>
              <Label htmlFor="lb-endpoint">Endpoint resource name</Label>
              <TextInput
                id="lb-endpoint"
                value={settings.lakebase.endpoint}
                onChange={v => setLakebase({ endpoint: v })}
                placeholder="projects/cluster-monitor/branches/production/endpoints/primary"
                mono
              />
              <p className="mt-1 text-xs text-gray-400">
                Create with:{' '}
                <code className="bg-gray-100 dark:bg-gray-700 rounded px-1">
                  databricks postgres create-project cluster-monitor --json
                </code>
              </p>
            </div>

            <div>
              <Label htmlFor="lb-database">Database name</Label>
              <TextInput
                id="lb-database"
                value={settings.lakebase.database}
                onChange={v => setLakebase({ database: v })}
                placeholder="databricks_postgres"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleTestLakebase}
                disabled={!settings.lakebase.endpoint || lbTestStatus === 'testing'}
                className="btn-outline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Test connection
              </button>
              <TestBadge status={lbTestStatus} result={lbTestResult} />
            </div>
          </SectionCard>

          <SectionCard
            title="Network"
            subtitle="Timeout applied to every Databricks API call — lower values surface problems faster, higher values tolerate slow networks."
          >
            <div className="flex items-center gap-4">
              <div className="flex-1 max-w-xs">
                <Label htmlFor="req-timeout">Request timeout (seconds)</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="req-timeout"
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={settings.request_timeout_seconds ?? 30}
                    onChange={e => setSettings(s => ({ ...s, request_timeout_seconds: Number(e.target.value) }))}
                    className="flex-1 accent-dbx-red"
                  />
                  <span className="w-12 text-right text-sm font-mono text-gray-700 dark:text-gray-300 tabular-nums">
                    {settings.request_timeout_seconds ?? 30}s
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Default 30 s. Applies to workspace access checks, discovers, and compute refreshes.
                  Permission checks run in parallel so total time ≈ this value, not N × this value.
                </p>
              </div>
            </div>
          </SectionCard>

          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
            <SaveBanner status={saveStatus} errorMsg={saveErrorMsg} />
          </div>

          <SectionCard title="Display" subtitle="Appearance preferences — saved in your browser.">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Dark mode</span>
                <p className="text-xs text-gray-400 mt-0.5">Remembered across sessions.</p>
              </div>
              <Toggle enabled={dark} onChange={v => { setDark(v); log('info', `Settings → Dark mode ${v ? 'enabled' : 'disabled'}`) }} />
            </div>
          </SectionCard>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Settings are persisted to{' '}
            <code className="bg-gray-100 dark:bg-gray-700 rounded px-1">settings.json</code>{' '}
            at the project root (or <code className="bg-gray-100 dark:bg-gray-700 rounded px-1">SETTINGS_PATH</code> env var).
            Point <code className="bg-gray-100 dark:bg-gray-700 rounded px-1">SETTINGS_PATH</code> to a Databricks Volume path
            to keep settings across app restarts.
          </p>
        </div>
      )}

      {/* ─────────────────── AUTHENTICATION TAB ───────────────────────── */}
      {activeTab === 'authentication' && (
        <div className="space-y-6">
          <SectionCard
            title="Service Principal"
            subtitle="Configure an account-level service principal to discover and connect to additional workspaces across your Databricks account."
          >
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label htmlFor="sp-account-id">Databricks Account ID</Label>
                <TextInput
                  id="sp-account-id"
                  value={settings.account_sp?.account_id ?? ''}
                  onChange={v => setAccountSp({ account_id: v })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  mono
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Found at <strong className="text-gray-500 dark:text-gray-400">accounts.azuredatabricks.net</strong> — top-right user menu or URL. Not your Azure subscription or Entra tenant ID.
                </p>
              </div>
              <div>
                <Label htmlFor="sp-client-id">Client ID</Label>
                <TextInput
                  id="sp-client-id"
                  value={settings.account_sp?.client_id ?? ''}
                  onChange={v => setAccountSp({ client_id: v })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  mono
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  From <strong className="text-gray-500 dark:text-gray-400">Account Console → Service Principals → [SP name]</strong>. The UUID shown as "Application ID" or "Client ID".
                </p>
              </div>
              <div>
                <Label htmlFor="sp-client-secret">Client Secret</Label>
                <TextInput
                  id="sp-client-secret"
                  type="password"
                  value={settings.account_sp?.client_secret ?? ''}
                  onChange={v => setAccountSp({ client_secret: v })}
                  placeholder={hasAccountSp ? '••••••••  (leave blank to keep existing)' : ''}
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Generate under <strong className="text-gray-500 dark:text-gray-400">Account Console → Service Principals → [SP] → Generate secret</strong>. Must be an <em>OAuth secret</em>, not an API token.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleValidateSp}
                disabled={spValidate.status === 'testing' || !settings.account_sp?.account_id || !settings.account_sp?.client_id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {spValidate.status === 'testing' ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Testing…
                  </>
                ) : 'Test credentials'}
              </button>
              <ValidateBadge status={spValidate.status} msg={spValidate.msg} />
            </div>
            <div className="flex items-start gap-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 px-3.5 py-3 text-xs text-blue-700 dark:text-blue-300">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>
                The service principal must be an <strong>account-level</strong> SP with at least{' '}
                <strong>Can View</strong> access on each workspace. Use <strong>Save settings</strong> below after entering credentials.
              </span>
            </div>
          </SectionCard>

          <div className="flex items-center gap-4">
            <button onClick={handleSave} disabled={saveStatus === 'saving'} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
              {saveStatus === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
            <SaveBanner status={saveStatus} errorMsg={saveErrorMsg} />
          </div>
        </div>
      )}

      {/* ─────────────────────── WORKSPACES TAB ────────────────────────── */}
      {activeTab === 'workspaces' && (
        <div className="space-y-6">
          <SectionCard
            title="Monitored Workspaces"
            subtitle="Select which workspaces to include in every refresh. The current workspace is always included. Configure authentication credentials first to discover additional workspaces."
          >
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleDiscover}
                disabled={wsDiscovering || !hasAccountSp}
                title={!hasAccountSp ? 'Configure a service principal in the Authentication tab first' : undefined}
                className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {wsDiscovering ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Discovering…
                  </>
                ) : '↻ Discover'}
              </button>


              {wsDiscoverMsg && (
                <span className={`text-xs ml-1 ${wsDiscoverMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {wsDiscoverMsg.ok ? '✓' : '✗'} {wsDiscoverMsg.text}
                </span>
              )}
            </div>

            {!hasAccountSp && (
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>
                  No credentials configured.{' '}
                  <button onClick={() => setActiveTab('authentication')} className="underline hover:text-gray-600 dark:hover:text-gray-300">
                    Go to Authentication
                  </button>{' '}
                  to set up cross-workspace access.
                </span>
              </div>
            )}

            {workspaces.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">
                No workspaces discovered yet. Configure authentication, then click Discover.
              </p>
            ) : (() => {
              const allRegions = Array.from(new Set(
                workspaces.map(w => w.region || '').filter(Boolean)
              )).sort()
              const q = wsSearch.trim().toLowerCase()
              // Apply search + region first, then the selected-only filter
              const matchesSearchRegion = (ws: WorkspaceConfig) => {
                const matchSearch = !q || ws.name.toLowerCase().includes(q) || ws.host.toLowerCase().includes(q)
                const matchRegion = !wsRegion || (ws.region || '') === wsRegion
                return matchSearch && matchRegion
              }
              const afterSearchRegion = workspaces.filter(matchesSearchRegion)
              const unselectedCount   = afterSearchRegion.filter(ws => !ws.enabled).length
              const filtered          = wsShowSelected
                ? afterSearchRegion.filter(ws => ws.enabled)
                : afterSearchRegion
              return (
                <div className="space-y-3">
                  {/* Search + region + selected filter row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[160px]">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search workspaces…"
                        value={wsSearch}
                        onChange={e => setWsSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {wsSearch && (
                        <button onClick={() => setWsSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {allRegions.length > 0 && (
                      <select
                        value={wsRegion}
                        onChange={e => setWsRegion(e.target.value)}
                        className="text-xs rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All regions</option>
                        {allRegions.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    )}
                    {/* Selected-only toggle */}
                    {wsShowSelected ? (
                      <button
                        onClick={() => setWsShowSelected(false)}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
                        title="Click to show all workspaces"
                      >
                        Selected ({filtered.length})
                        {unselectedCount > 0 && (
                          <span className="rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                            +{unselectedCount} unselected
                          </span>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => setWsShowSelected(true)}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                        title="Click to show selected only"
                      >
                        All ({afterSearchRegion.length})
                      </button>
                    )}
                  </div>

                  {/* Enable / Disable All + Check Permissions row */}
                  {filtered.length > 0 && (() => {
                    const filteredHosts = new Set(filtered.map(w => w.host))
                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => {
                            setWorkspaces(ws => ws.map(w => filteredHosts.has(w.host) ? { ...w, enabled: true } : w))
                            setWsDirty(true)
                            log('info', `Settings → Enabled all ${filtered.length} workspace${filtered.length !== 1 ? 's' : ''} in current view`)
                          }}
                          className="btn-outline text-xs py-1 px-2.5"
                        >
                          Enable All Visible
                        </button>
                        <button
                          onClick={() => {
                            setWorkspaces(ws => ws.map(w => filteredHosts.has(w.host) ? { ...w, enabled: w.current ? true : false } : w))
                            setWsDirty(true)
                            const nonCurrent = filtered.filter(w => !w.current).length
                            log('info', `Settings → Disabled ${nonCurrent} workspace${nonCurrent !== 1 ? 's' : ''} in current view`)
                          }}
                          className="btn-outline text-xs py-1 px-2.5"
                        >
                          Disable All Visible
                        </button>
                        {hasAccountSp && (
                          <button
                            onClick={() => handleCheckPermissions(filtered.map(w => w.host))}
                            disabled={wsChecking}
                            title={`Check SP permissions on ${filtered.length} visible workspace${filtered.length !== 1 ? 's' : ''}`}
                            className="btn-outline text-xs py-1 px-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                          >
                            {wsChecking ? (
                              <>
                                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Checking…
                              </>
                            ) : `🔑 Check Permissions (${filtered.length})`}
                          </button>
                        )}
                      </div>
                    )
                  })()}

                  {/* Workspace list */}
                  {filtered.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">No workspaces match the current filter.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      {filtered.map(ws => {
                        const i         = workspaces.indexOf(ws)
                        const perm      = wsPerms[ws.host]
                        const isCheckingRow = perm?.status === 'checking'
                        const isGranting    = !!wsGranting[ws.host]
                        const busy          = isCheckingRow || isGranting
                        // Grant Admin is available whenever: SP configured, workspace ID known, not already admin, not busy
                        const canGrant  = hasAccountSp && !!ws.workspace_id && perm?.status !== 'admin' && !busy
                        const noId      = hasAccountSp && !ws.workspace_id && perm?.status !== 'admin'
                        return (
                          <div key={ws.host} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800">
                            {/* Name + tags */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <a
                                  href={ws.host}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate hover:text-dbx-red hover:underline"
                                  title={`Open workspace: ${ws.host}`}
                                >
                                  {ws.name}
                                </a>
                                {ws.current && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0">
                                    this app
                                  </span>
                                )}
                                {ws.region && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 flex-shrink-0">
                                    {ws.region}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 truncate mt-0.5">{ws.host}</p>
                            </div>

                            {/* Permission actions — visible whenever SP is configured */}
                            {hasAccountSp && (
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {/* Status badge */}
                                <PermBadge status={perm?.status ?? 'unchecked'} error={perm?.error} />

                                {/* Per-row Check button */}
                                {isCheckingRow ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 italic">
                                    <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Checking…
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleCheckPermissions([ws.host])}
                                    disabled={wsChecking}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                    title="Check SP permissions on this workspace"
                                  >
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    Check
                                  </button>
                                )}

                                {/* Grant Admin button — always available when SP configured + workspace ID exists */}
                                {isGranting ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 italic">
                                    <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Granting…
                                  </span>
                                ) : perm?.status === 'admin' ? null : canGrant ? (
                                  <button
                                    onClick={() => handleGrantAdmin(ws)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition"
                                    title="Grant workspace admin to the configured SP via account assignment API"
                                  >
                                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                                    </svg>
                                    Grant Admin
                                  </button>
                                ) : noId ? (
                                  <span
                                    className="text-[10px] text-gray-400 italic cursor-help"
                                    title="Workspace ID not stored — click ↻ Discover then Save workspaces to populate it. The numeric ID is required to call the WorkspaceAssignment API."
                                  >
                                    ⚠ Re-discover to enable Grant Admin
                                  </span>
                                ) : null}
                              </div>
                            )}

                            {/* Enable/disable toggle */}
                            <Toggle
                              enabled={ws.enabled}
                              onChange={v => {
                                if (ws.current) return
                                setWorkspaces(prev => prev.map((w, j) => j === i ? { ...w, enabled: v } : w))
                                setWsDirty(true)
                                log('info', `Settings → ${ws.name} ${v ? 'enabled' : 'disabled'} (unsaved)`)
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {workspaces.length > 0 && (
              <div className="flex items-center gap-4 pt-1">
                <button onClick={handleSaveWorkspaces} disabled={wsSaveStatus === 'saving'} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60 disabled:cursor-not-allowed">
                  {wsSaveStatus === 'saving' ? 'Saving…' : 'Save workspaces'}
                </button>
                {wsSaveStatus === 'saved' && <span className="text-xs text-green-600 dark:text-green-400">✓ Workspace config saved</span>}
                {wsSaveStatus === 'error'  && <span className="text-xs text-red-600 dark:text-red-400">✗ Save failed</span>}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  )
}
