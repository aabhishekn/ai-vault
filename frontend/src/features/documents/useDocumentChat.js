import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { canAskDocument, validateQuestion } from './answers'
import {
  createConversation,
  createMultiConversation,
  getLatestConversation,
  sendMessageStream,
} from './conversations'

const REQUEST_TIMEOUT_MS = 120_000
const RESTORE_TIMEOUT_MS = 15_000

// Owns the open conversation for one mounted document view; render it with key={id}.
// A document's latest saved conversation is restored once, so closing details loses nothing.
// With `documentIds` (and a null id) the conversation spans those documents instead;
// it starts fresh each time because it is not tied to a single document.
export function useDocumentChat(id, documentStatus, documentIds) {
  const [state, setState] = useState({
    turns: [],
    pendingQuestion: null,
    streamingText: '',
    error: null,
    replacing: null, // the turn an edit is replacing, while its new answer is written
  })
  const [restored, setRestored] = useState(false)
  const activeRequest = useRef(null)
  const conversationId = useRef(null)
  const eligible = canAskDocument(documentStatus)
  const multi = id === null
  const restoring = eligible && !restored && !multi

  useEffect(() => {
    if (!eligible || restored || id === null) return
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
          replacing: null,
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

  // Resolves true only when the question was answered and saved. With `replaceTurn` the
  // answer takes that turn's place and the turns after it go; until it is saved they stay.
  async function send(question, replaceTurn = null) {
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
      replacing: replaceTurn,
    }))
    try {
      // The conversation is created lazily so merely opening details costs nothing.
      conversationId.current ??= id
        ? await createConversation(id, signal)
        : await createMultiConversation(documentIds ?? [], signal)
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
        replaceTurn,
      )
      if (controller.signal.aborted) return false
      setState((previous) => ({
        turns: [
          ...(replaceTurn === null
            ? previous.turns
            : previous.turns.filter((item) => item.turnNumber < replaceTurn)),
          turn,
        ],
        pendingQuestion: null,
        streamingText: '',
        error: null,
        replacing: null,
      }))
      return true
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          pendingQuestion: null,
          streamingText: '',
          replacing: null,
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
      replacing: null,
    })
  }

  return { ...state, restoring, send, startNewConversation }
}
