import { useEffect, useMemo, useState } from 'react'
import { listDocuments } from './api'
import { canAskDocument } from './answers'
import { readyEntries } from './scope'

const WAITING = new Set(['queued', 'processing', 'extracted'])

// Which documents the chat can ask about, newest first, however many pages the list has.
// The list's own page is used when it holds everything; otherwise one larger request
// fills in the rest. If that request fails the visible page still works.
export function useReadyDocuments(listState) {
  const page = listState.status === 'success' ? listState.page : null
  const local = useMemo(() => (page ? readyEntries(page.items) : []), [page])
  const hasMore = page !== null && page.total > page.items.length
  const signature = hasMore
    ? `${page.total}|${page.items.map((item) => `${item.id}:${item.status}:${item.title ?? ''}`).join(',')}`
    : ''
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
