import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { getDocument } from './api'
import type { VaultDocument } from './types'

type DocumentState =
  | { status: 'loading' }
  | { status: 'success'; document: VaultDocument }
  | { status: 'error'; message: string }

export function useDocument(id: string) {
  const [state, setState] = useState<DocumentState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const document = await getDocument(
          id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        )
        if (!controller.signal.aborted)
          setState({ status: 'success', document })
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message:
              error instanceof ApiError
                ? error.message
                : 'We couldn’t load this document. Check your connection and try again.',
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
