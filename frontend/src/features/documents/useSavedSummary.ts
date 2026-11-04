import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { getSavedSummary, type SavedSummary } from './summary'

type SummaryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'success'; summary: SavedSummary }
  | { status: 'error'; message: string }

export function useSavedSummary(id: string) {
  const [state, setState] = useState<SummaryState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const summary = await getSavedSummary(
          id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        )
        if (!controller.signal.aborted) {
          setState(
            summary ? { status: 'success', summary } : { status: 'empty' },
          )
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message:
              error instanceof ApiError
                ? error.message
                : 'We couldn’t load the saved summary. Check your connection and try again.',
          })
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [id, revision])

  function refresh() {
    setState({ status: 'loading' })
    setRevision((previous) => previous + 1)
  }
  return { state, refresh }
}
