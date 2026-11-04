import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { listDocuments, type DocumentFilter } from './api'
import type { DocumentPage } from './types'

const PAGE_SIZE = 10

type DocumentListState =
  | { status: 'loading' }
  | { status: 'success'; page: DocumentPage }
  | { status: 'error'; message: string }

export function useDocuments() {
  const [query, setQuery] = useState<{
    offset: number
    revision: number
    filter: DocumentFilter
  }>({ offset: 0, revision: 0, filter: {} })
  const [state, setState] = useState<DocumentListState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10_000),
    ])

    async function load() {
      try {
        const page = await listDocuments({
          limit: PAGE_SIZE,
          offset: query.offset,
          filter: query.filter,
          signal,
        })
        if (controller.signal.aborted) return
        // If the last page disappeared, request the nearest valid page.
        if (page.offset > 0 && page.offset >= page.total) {
          const offset =
            Math.max(0, Math.ceil(page.total / PAGE_SIZE) - 1) * PAGE_SIZE
          setQuery((previous) => ({ ...previous, offset }))
          return
        }
        setState({ status: 'success', page })
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'We couldn’t load your documents. Check your connection and try again.',
        })
      }
    }

    void load()
    return () => controller.abort()
  }, [query])

  function refresh() {
    setState({ status: 'loading' })
    setQuery((previous) => ({ ...previous, revision: previous.revision + 1 }))
  }

  function goToPage(offset: number) {
    setState({ status: 'loading' })
    setQuery((previous) => ({ ...previous, offset }))
  }

  // Changing the filter always returns to the first page.
  function setFilter(filter: DocumentFilter) {
    setState({ status: 'loading' })
    setQuery((previous) => ({ ...previous, offset: 0, filter }))
  }

  return { state, refresh, goToPage, filter: query.filter, setFilter }
}
