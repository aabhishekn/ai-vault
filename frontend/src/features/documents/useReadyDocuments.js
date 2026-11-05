import { useEffect, useMemo, useState } from 'react'
import { listDocuments } from './api'
import { canAskDocument } from './answers'
import { readyEntries } from './scope'

const WAITING = new Set(['queued', 'processing', 'extracted'])

// What about a list matters here: its size, and each document's id, status and title.
const listKey = (page) =>
  `${page.total}|${page.items.map((item) => `${item.id}:${item.status}:${item.title ?? ''}`).join(',')}`

// Which documents the chat can ask about, newest first, however many pages the list has.
// The list's own page is used when it holds everything; otherwise one larger request
// fills in the rest. If that request fails the visible page still works.
//
// While the list is being searched it shows only the matches, which must not change what
// the chat can ask about, so the whole library is read separately (and the last full view
// of it stands in until that arrives).
export function useReadyDocuments(listState, searching = false) {
  const shown = listState.status === 'success' ? listState.page : null
  const [whole, setWhole] = useState(null)
  // The last list seen while not searching, kept for the moment a search begins. It is
  // replaced only when what it holds changes, so a fresh copy of the same list is no change.
  const [full, setFull] = useState({ key: '', page: null })
  const shownKey = shown ? listKey(shown) : ''
  if (!searching && shown && full.key !== shownKey)
    setFull({ key: shownKey, page: shown })

  useEffect(() => {
    if (!searching) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10_000),
    ])
    listDocuments({ limit: 100, offset: 0, signal })
      .then((all) => {
        if (!controller.signal.aborted) setWhole(all)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [searching, shown])

  const page = searching ? (whole ?? full.page) : shown
  const local = useMemo(() => (page ? readyEntries(page.items) : []), [page])
  const hasMore = page !== null && page.total > page.items.length
  const signature = hasMore ? listKey(page) : ''
  const [more, setMore] = useState({ signature: '', entries: [] })

  useEffect(() => {
    if (!signature) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10_000),
    ])
    listDocuments({ limit: 100, offset: 0, signal })
      .then((all) => {
        if (!controller.signal.aborted)
          setMore({ signature, entries: readyEntries(all.items) })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [signature])

  const ready = hasMore && more.signature === signature ? more.entries : local
  const known = page ? page.items : []
  return {
    ready,
    total: page ? page.total : 0,
    loaded: page !== null,
    waiting: known.filter((item) => WAITING.has(item.status)).length,
    anyReady:
      ready.length > 0 || known.some((item) => canAskDocument(item.status)),
  }
}
