import { useEffect, useRef, useState } from 'react'
import type { LogEntry, LogLevel } from '../types'

const LEVEL_CLASSES: Record<LogLevel, string> = {
  info:    'bg-gray-100    text-gray-600   dark:bg-slate-700/60  dark:text-slate-300',
  success: 'bg-green-100   text-green-700  dark:bg-green-900/40  dark:text-green-300',
  warning: 'bg-yellow-100  text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  error:   'bg-red-100     text-red-700    dark:bg-red-900/40    dark:text-red-300',
}

const LS_KEY = 'cluster-monitor:log-open'

interface Props {
  entries: LogEntry[]
  onClear: () => void
}

export function ActivityLog({ entries, onClear }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY) === 'true'
    } catch {
      return false
    }
  })

  const listRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(entries.length)

  // Persist open/closed state
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, String(open))
    } catch {
      // storage unavailable — ignore
    }
  }, [open])

  // Scroll to top when a new entry arrives (newest is at top)
  useEffect(() => {
    if (entries.length > prevLen.current && listRef.current) {
      listRef.current.scrollTop = 0
    }
    prevLen.current = entries.length
  }, [entries.length])

  const errorCount = entries.filter(e => e.level === 'error').length
  const hasUnseen = entries.length > 0 && !open

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {open && (
        <div
          className="card flex flex-col shadow-xl"
          style={{ width: '420px', maxWidth: 'calc(100vw - 2.5rem)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50 rounded-t-lg dark:bg-slate-800 dark:border-slate-700">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <span className="text-base">⬛</span>
              Activity log
              {entries.length > 0 && (
                <span className="text-xs text-gray-400 dark:text-slate-400 font-normal">{entries.length} entries</span>
              )}
            </span>
            <button
              className="btn-outline text-xs py-0.5 px-2"
              onClick={onClear}
            >
              Clear
            </button>
          </div>

          {/* Log entries */}
          <div
            ref={listRef}
            className="overflow-y-auto px-3 py-2 font-mono text-xs dark:bg-slate-900/50"
            style={{ maxHeight: '300px' }}
          >
            {entries.length === 0 ? (
              <p className="text-gray-400 dark:text-slate-500 py-2">
                Log appears here on refresh. Errors and API failures are always shown.
              </p>
            ) : (
              entries.map((e, i) => (
                <div key={i} className="log-row">
                  <span className="text-gray-400 dark:text-slate-500 shrink-0">{e.time}</span>
                  <span className={`state-badge shrink-0 ${LEVEL_CLASSES[e.level]}`}>
                    {e.level.toUpperCase()}
                  </span>
                  <span className="text-gray-700 dark:text-slate-200 break-all">{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={open ? 'Collapse activity log' : 'Expand activity log'}
        className="flex items-center gap-2 rounded-full shadow-lg px-4 py-2.5 text-sm font-semibold text-white transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-dbx-red"
        style={{ backgroundColor: errorCount > 0 ? '#b91c1c' : '#1B1B1B' }}
      >
        {/* Terminal icon */}
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z"
            clipRule="evenodd"
          />
        </svg>

        <span>{open ? 'Close log' : 'Activity log'}</span>

        {/* Unread / error badge */}
        {!open && errorCount > 0 && (
          <span className="rounded-full bg-red-400 text-white text-xs font-bold leading-none px-1.5 py-0.5">
            {errorCount} err
          </span>
        )}
        {!open && errorCount === 0 && hasUnseen && (
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
        )}

        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  )
}
