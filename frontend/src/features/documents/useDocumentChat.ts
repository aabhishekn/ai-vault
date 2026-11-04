import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { canAskDocument, validateQuestion } from './answers'
import {
  createConversation,
  getLatestConversation,
  sendMessageStream,
  type ChatTurn,
} from './conversations'
import type { DocumentStatus } from './types'

const REQUEST_TIMEOUT_MS = 120_000
const RESTORE_TIMEOUT_MS = 15_000

type ChatState = {
  turns: ChatTurn[]
  pendingQuestion: string | null
  // Answer text received so far for the pending question (a preview of the final answer).
  streamingText: string
  error: string | null
}

// Owns the open conversation for one mounted document view; render it with key={id}.
// A document's latest saved conversation is restored once, so closing details loses nothing.
export function useDocumentChat(id: string, documentStatus: DocumentStatus) {
  const [state, setState] = useState<ChatState>({
    turns: [],
    pendingQuestion: null,
    streamingText: '',
    error: null,
  })
  const [restored, setRestored] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const conversationId = useRef<string | null>(null)
  const eligible = canAskDocument(documentStatus)
  const restoring = eligible && !restored

  useEffect(() => {
    if (!eligible || restored) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    ])
    getLatestConversation(id, signal)
      .then((saved) => {
        if (controller.signal.aborted || !saved || conversationId.current)
          return
        conversationId.current = saved.id
        setState({
          turns: saved.turns,
          pendingQuestion: null,
          streamingText: '',
          error: null,
        })
      })
      // Restoring is a convenience: if it fails, asking a new question still works.
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setRestored(true)
      })
    return () => controller.abort()
  }, [id, eligible, restored])

  useEffect(
    () => () => {
      activeRequest.current?.abort()
      activeRequest.current = null
    },
    [],
  )

  // Resolves true only when the question was answered and saved.
  async function send(question: string): Promise<boolean> {
    if (activeRequest.current || !canAskDocument(documentStatus)) return false
    const message = validateQuestion(question)
    if (message) {
      setState((previous) => ({ ...previous, error: message }))
      return false
    }
    const controller = new AbortController()
    activeRequest.current = controller
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ])
    setState((previous) => ({
      ...previous,
      pendingQuestion: question.trim(),
      streamingText: '',
      error: null,
    }))
    try {
      // The conversation is created lazily so merely opening details costs nothing.
      conversationId.current ??= await createConversation(id, signal)
      const turn = await sendMessageStream(
        id,
        conversationId.current,
        question,
        signal,
        (text) =>
          setState((previous) => ({
            ...previous,
            streamingText: previous.streamingText + text,
          })),
      )
      if (controller.signal.aborted) return false
      setState((previous) => ({
        turns: [...previous.turns, turn],
        pendingQuestion: null,
        streamingText: '',
        error: null,
      }))
      return true
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          pendingQuestion: null,
          streamingText: '',
          error:
            error instanceof ApiError
              ? error.message
              : 'We couldn’t complete your answer. Please try again.',
        }))
      return false
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  // Forget the open conversation; the next question starts a fresh one. Saved turns stay saved.
  function startNewConversation() {
    if (activeRequest.current) return
    conversationId.current = null
    setState({
      turns: [],
      pendingQuestion: null,
      streamingText: '',
      error: null,
    })
  }

  return { ...state, restoring, send, startNewConversation }
}
