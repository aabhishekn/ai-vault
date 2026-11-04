import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import {
  askDocument,
  canAskDocument,
  validateQuestion,
  type DocumentAnswer,
} from './answers'
import type { DocumentStatus } from './types'

type AnswerState =
  | { status: 'idle' }
  | { status: 'asking'; question: string }
  | { status: 'success'; data: DocumentAnswer }
  | { status: 'error'; message: string }

export function useDocumentAnswer(id: string, documentStatus: DocumentStatus) {
  const [request, setRequest] = useState<{ id: string; state: AnswerState }>({
    id,
    state: { status: 'idle' },
  })
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      activeRequest.current?.abort()
      activeRequest.current = null
    },
    [id],
  )

  async function ask(question: string) {
    if (activeRequest.current || !canAskDocument(documentStatus)) return
    const message = validateQuestion(question)
    if (message) {
      setRequest({ id, state: { status: 'error', message } })
      return
    }
    const controller = new AbortController()
    activeRequest.current = controller
    setRequest({ id, state: { status: 'asking', question: question.trim() } })
    try {
      const data = await askDocument(
        id,
        question,
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
              error instanceof ApiError
                ? error.message
                : 'We couldn’t complete your answer. Please try again.',
          },
        })
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }
  const state: AnswerState =
    request.id === id ? request.state : { status: 'idle' }
  return { state, ask }
}
