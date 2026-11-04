import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { canAskDocument, validateQuestion } from './answers'
import { createConversation, sendMessage, type ChatTurn } from './conversations'
import type { DocumentStatus } from './types'

const REQUEST_TIMEOUT_MS = 120_000

type ChatState = {
  turns: ChatTurn[]
  pendingQuestion: string | null
  error: string | null
}

// Owns one conversation per mounted document view; render it with key={id}.
export function useDocumentChat(id: string, documentStatus: DocumentStatus) {
  const [state, setState] = useState<ChatState>({
    turns: [],
    pendingQuestion: null,
    error: null,
  })
  const activeRequest = useRef<AbortController | null>(null)
  const conversationId = useRef<string | null>(null)

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
      error: null,
    }))
    try {
      // The conversation is created lazily so merely opening details costs nothing.
      conversationId.current ??= await createConversation(id, signal)
      const turn = await sendMessage(
        id,
        conversationId.current,
        question,
        signal,
      )
      if (controller.signal.aborted) return false
      setState((previous) => ({
        turns: [...previous.turns, turn],
        pendingQuestion: null,
        error: null,
      }))
      return true
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          pendingQuestion: null,
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

  return { ...state, send }
}
