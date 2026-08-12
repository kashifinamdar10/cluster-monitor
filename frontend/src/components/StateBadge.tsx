const STATE_CLASSES: Record<string, string> = {
  RUNNING:     'bg-green-100  text-green-800  dark:bg-green-900/40  dark:text-green-300',
  PENDING:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  STARTING:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  TERMINATED:  'bg-gray-100   text-gray-600   dark:bg-slate-700/60  dark:text-slate-300',
  STOPPED:     'bg-gray-100   text-gray-600   dark:bg-slate-700/60  dark:text-slate-300',
  TERMINATING: 'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  STOPPING:    'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  RESTARTING:  'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  RESIZING:    'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  ERROR:       'bg-red-100    text-red-800    dark:bg-red-900/40    dark:text-red-300',
  DELETING:    'bg-red-100    text-red-800    dark:bg-red-900/40    dark:text-red-300',
  DELETED:     'bg-gray-200   text-gray-500   dark:bg-slate-700/40  dark:text-slate-400',
  UNKNOWN:     'bg-gray-100   text-gray-500   dark:bg-slate-700/40  dark:text-slate-400',
}

export function StateBadge({ state }: { state: string }) {
  const cls = STATE_CLASSES[state?.toUpperCase()] ?? 'bg-gray-100 text-gray-500 dark:bg-slate-700/40 dark:text-slate-400'
  return <span className={`state-badge ${cls}`}>{state}</span>
}
