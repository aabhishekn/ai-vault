import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'

type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

// Pass a stable API function; this hook owns read-only requests, never mutations.
export function useResource<T>(
  key: string,
  loadResource: (key: string, signal: AbortSignal) => Promise<T>,
  fallbackMessage: string,
) {
  const [request, setRequest] = useState<{
    key: string
    state: ResourceState<T>
  }>({
    key,
    state: { status: 'loading' },
  })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await loadResource(
          key,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        )
        if (!controller.signal.aborted)
          setRequest({ key, state: { status: 'success', data } })
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setRequest({
            key,
            state: {
              status: 'error',
              message:
                error instanceof ApiError ? error.message : fallbackMessage,
            },
          })
      }
    }
    void load()
    return () => controller.abort()
  }, [key, loadResource, fallbackMessage, revision])

  function refresh() {
    setRequest({ key, state: { status: 'loading' } })
    setRevision((previous) => previous + 1)
  }
  // Never display a previous key's data while its replacement request starts.
  const state: ResourceState<T> =
    request.key === key ? request.state : { status: 'loading' }
  return { state, refresh }
}
