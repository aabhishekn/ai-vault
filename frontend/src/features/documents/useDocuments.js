import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { listDocuments } from './api'

const PAGE_SIZE = 10

export function useDocuments() {
  const [query, setQuery] = useState({ offset: 0, revision: 0, filter: {} })
  const [state, setState] = useState({ status: 'loading' })

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
      } catch (error) {
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

  // Reload the current page without a loading state, for server-pushed changes.
  function refreshQuietly() {
    setQuery((previous) => ({ ...previous, revision: previous.revision + 1 }))
  }

  // Write a change the server has just confirmed into the page on screen. Does nothing
  // until a page has loaded; callers follow up with refreshQuietly to reconcile.
  function changePage(change) {
    setState((previous) =>
      previous.status === 'success'
        ? { status: 'success', page: change(previous.page) }
        : previous,
    )
  }

  function goToPage(offset) {
    setState({ status: 'loading' })
    setQuery((previous) => ({ ...previous, offset }))
  }

  // Changing the filter always returns to the first page.
  function setFilter(filter) {
    setState({ status: 'loading' })
    setQuery((previous) => ({ ...previous, offset: 0, filter }))
  }

  return {
    state,
    refresh,
    refreshQuietly,
    changePage,
    goToPage,
    filter: query.filter,
    setFilter,
  }
}
