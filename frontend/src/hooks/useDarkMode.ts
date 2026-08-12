import { useState, useEffect } from 'react'

const KEY = 'dbx-monitor-dark-mode'

export function useDarkMode(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem(KEY)
    if (stored !== null) return stored === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(KEY, String(dark))
  }, [dark])

  return [dark, setDark]
}
