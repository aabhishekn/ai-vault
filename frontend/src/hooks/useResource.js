import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'

// Pass a stable API function; this hook owns read-only requests, never mutations.
export function useResource(key, loadResource, fallbackMessage) {
  const [request, setRequest] = useState({
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
      } catch (error) {
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
  // Fetch again without clearing what is shown (used when the server pushes a change).
  function refreshQuietly() {
    setRevision((previous) => previous + 1)
  }
  // Never display a previous key's data while its replacement request starts.
  const state = request.key === key ? request.state : { status: 'loading' }
  return { state, refresh, refreshQuietly }
}
