import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'

type ContentState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'generating' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

type ContentApi<T> = {
  load: (id: string, signal: AbortSignal) => Promise<T | null>
  generate: (id: string, signal: AbortSignal) => Promise<T>
  loadError: string
  generationError: string
}

// Pass a stable API object. Effects only read; generation requires an explicit action.
export function useGeneratedDocumentContent<T>(
  id: string,
  canGenerate: boolean,
  api: ContentApi<T>,
) {
  const [request, setRequest] = useState<{
    id: string
    state: ContentState<T>
  }>({ id, state: { status: 'loading' } })
  const [revision, setRevision] = useState(0)
  const activeRequest = useRef<AbortController | null>(null)
  const readPending = useRef(true)
  const state: ContentState<T> =
    request.id === id ? request.state : { status: 'loading' }

  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = controller
    readPending.current = false
    async function load() {
      try {
        const data = await api.load(
          id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        )
        if (!controller.signal.aborted)
          setRequest({
            id,
            state:
              data === null ? { status: 'empty' } : { status: 'success', data },
          })
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setRequest({
            id,
            state: {
              status: 'error',
              message:
                error instanceof ApiError ? error.message : api.loadError,
            },
          })
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null
      }
    }
    void load()
    return () => {
      // Also cancel a generation started after this read completed.
      activeRequest.current?.abort()
      activeRequest.current = null
      controller.abort()
    }
  }, [id, revision, api])

  function refresh() {
    if (activeRequest.current || readPending.current) return
    readPending.current = true
    setRequest({ id, state: { status: 'loading' } })
    setRevision((previous) => previous + 1)
  }

  async function generate() {
    if (
      activeRequest.current ||
      readPending.current ||
      state.status !== 'empty' ||
      !canGenerate
    )
      return
    const controller = new AbortController()
    activeRequest.current = controller
    setRequest({ id, state: { status: 'generating' } })
    try {
      const data = await api.generate(
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      )
      if (!controller.signal.aborted)
        setRequest({ id, state: { status: 'success', data } })
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setRequest({
          id,
          state: {
            status: 'error',
            message:
              error instanceof ApiError ? error.message : api.generationError,
          },
        })
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }
  return { state, refresh, generate }
}
