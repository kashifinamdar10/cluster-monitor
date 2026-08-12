import { useState, useRef, useCallback, useMemo, useEffect } from 'react'

// ── Column sorting ─────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'

export function useTableSort<T>(rows: T[]) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
        return key
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const sorted = useMemo((): T[] => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const av = (a as any)[sortKey] ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bv = (b as any)[sortKey] ?? ''
      const an = Number(av)
      const bn = Number(bv)
      const cmp =
        !isNaN(an) && !isNaN(bn)
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, {
              numeric: true,
              sensitivity: 'base',
            })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  return { sortKey, sortDir, toggleSort, sorted }
}

// ── Column resize ──────────────────────────────────────────────────────────────

export function useColumnResize(initial: number[]) {
  const [widths, setWidths] = useState(initial)
  // Keep a ref so onDragStart always reads the latest widths without needing
  // them as a dependency (avoids re-creating drag handlers mid-drag).
  const widthsRef = useRef(widths)
  useEffect(() => {
    widthsRef.current = widths
  }, [widths])

  const drag = useRef<{ col: number; x0: number; w0: number } | null>(null)

  const onDragStart = useCallback(
    (col: number) => (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { col, x0: e.clientX, w0: widthsRef.current[col] }
    },
    [],
  )

  const onDragMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const newW = Math.max(48, d.w0 + (e.clientX - d.x0))
    setWidths(prev => prev.map((w, i) => (i === d.col ? newW : w)))
  }, [])

  const onDragEnd = useCallback(() => {
    drag.current = null
  }, [])

  return { widths, onDragStart, onDragMove, onDragEnd }
}
