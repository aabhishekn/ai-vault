import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../lib/api'

// Pass a stable API object. Effects only read; generation requires an explicit action.
export function useGeneratedDocumentContent(id, canGenerate, api) {
  const [request, setRequest] = useState({ id, state: { status: 'loading' } })
  const [revision, setRevision] = useState(0)
  const activeRequest = useRef(null)
  const readPending = useRef(true)
  const state = request.id === id ? request.state : { status: 'loading' }

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
      } catch (error) {
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
    } catch (error) {
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
