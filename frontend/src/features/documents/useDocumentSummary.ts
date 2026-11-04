import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import {
  canGenerateSummary,
  generateDocumentSummary,
  getSavedSummary,
  type SavedSummary,
} from './summary'
import type { DocumentStatus } from './types'

type SummaryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'generating' }
  | { status: 'success'; summary: SavedSummary }
  | { status: 'error'; message: string }

export function useDocumentSummary(id: string, documentStatus: DocumentStatus) {
  const [state, setState] = useState<SummaryState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = controller
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
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null
      }
    }
    void load()
    return () => {
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [id, revision])

  function refresh() {
    if (activeRequest.current) return
    setState({ status: 'loading' })
    setRevision((previous) => previous + 1)
  }

  async function generate() {
    if (
      activeRequest.current ||
      state.status !== 'empty' ||
      !canGenerateSummary(documentStatus)
    )
      return
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'generating' })
    try {
      const summary = await generateDocumentSummary(
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      )
      if (!controller.signal.aborted) setState({ status: 'success', summary })
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'Summary generation could not be confirmed. Refresh the summary before trying again.',
        })
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }
  return { state, refresh, generate }
}
