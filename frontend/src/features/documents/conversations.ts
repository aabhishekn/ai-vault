import { ApiError, getJson, requestJson } from '../../lib/api'
import {
  parseAnswer,
  toAnswerError,
  validateQuestion,
  type DocumentAnswer,
} from './answers'

export type ChatTurn = {
  id: string
  turnNumber: number
  answer: DocumentAnswer
}

const INVALID_RESPONSE =
  'The document service returned an invalid conversation response. Please try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function createConversation(
  documentId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(documentId)}/conversations`,
      signal,
      { method: 'POST' },
    )
    if (
      !isRecord(data) ||
      typeof data.id !== 'string' ||
      !data.id.trim() ||
      data.document_id !== documentId
    )
      throw new ApiError(INVALID_RESPONSE)
    return data.id
  } catch (error: unknown) {
    throw toAnswerError(error)
  }
}

/** A conversation that answers from several documents at once. */
export async function createMultiConversation(
  documentIds: string[],
  signal: AbortSignal,
): Promise<string> {
  try {
    const data = await requestJson('/multi-conversations', signal, {
      method: 'POST',
      json: { document_ids: documentIds },
    })
    if (
      !isRecord(data) ||
      typeof data.id !== 'string' ||
      !data.id.trim() ||
      data.document_id !== null
    )
      throw new ApiError(INVALID_RESPONSE)
    return data.id
  } catch (error: unknown) {
    throw toAnswerError(error)
  }
}

function parseTurn(
  data: unknown,
  documentId: string | null,
  conversationId: string,
  question: string,
): ChatTurn {
  if (
    !isRecord(data) ||
    data.conversation_id !== conversationId ||
    typeof data.id !== 'string' ||
    !Number.isSafeInteger(data.turn_number)
  )
    throw new ApiError(INVALID_RESPONSE)
  return {
    id: data.id,
    turnNumber: Number(data.turn_number),
    answer: parseAnswer(data.response, documentId, question),
  }
}

export async function sendMessage(
  documentId: string | null,
  conversationId: string,
  question: string,
  signal: AbortSignal,
): Promise<ChatTurn> {
  const validationError = validateQuestion(question)
  if (validationError) throw new ApiError(validationError)
  const normalized = question.trim()
  try {
    const data = await requestJson(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      signal,
      { method: 'POST', json: { question: normalized, top_k: 3 } },
    )
    return parseTurn(data, documentId, conversationId, normalized)
  } catch (error: unknown) {
    throw toAnswerError(error)
  }
}

type ServerEvent = { name: string; data: unknown }

// Splits a server-sent-event byte stream into events; chunk boundaries can fall anywhere.
async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = parseEvent(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (event) yield event
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function parseEvent(block: string): ServerEvent | null {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  try {
    return { name, data: JSON.parse(data.join('\n')) as unknown }
  } catch {
    throw new ApiError(INVALID_RESPONSE)
  }
}

/**
 * Sends a question and reports the answer text as the server writes it.
 * The streamed text is only a preview: the returned turn is the saved, validated
 * answer with its citations, and callers should show that instead.
 */
export async function sendMessageStream(
  documentId: string | null,
  conversationId: string,
  question: string,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<ChatTurn> {
  const validationError = validateQuestion(question)
  if (validationError) throw new ApiError(validationError)
  const normalized = question.trim()
  try {
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/stream`,
      {
        method: 'POST',
        signal,
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: normalized, top_k: 3 }),
      },
    )
    if (!response.ok)
      throw new ApiError(
        'The document service is unavailable. Make sure your backend is running, then try again.',
        response.status,
      )
    if (!response.body) throw new ApiError(INVALID_RESPONSE)
    for await (const event of readEvents(response.body)) {
      if (event.name === 'delta' && isRecord(event.data)) {
        if (typeof event.data.text === 'string') onText(event.data.text)
      } else if (event.name === 'turn') {
        return parseTurn(event.data, documentId, conversationId, normalized)
      } else if (event.name === 'error') {
        const status =
          isRecord(event.data) && Number.isSafeInteger(event.data.status)
            ? Number(event.data.status)
            : 500
        throw new ApiError('The answer could not be completed.', status)
      }
    }
    // The stream ended without a saved turn (connection dropped mid-answer).
    throw new ApiError(INVALID_RESPONSE)
  } catch (error: unknown) {
    throw toAnswerError(error)
  }
}

// The history endpoint pages at 100 turns; the newest turns are the ones worth showing.
const HISTORY_PAGE_SIZE = 100

export type SavedConversation = { id: string; turns: ChatTurn[] }

function parseSavedTurn(data: unknown, documentId: string): ChatTurn {
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    !Number.isSafeInteger(data.turn_number) ||
    !isRecord(data.response) ||
    typeof data.response.question !== 'string'
  )
    throw new ApiError(INVALID_RESPONSE)
  return {
    id: data.id,
    turnNumber: Number(data.turn_number),
    answer: parseAnswer(data.response, documentId, data.response.question),
  }
}

/** The document's most recent answered conversation, or null when it has none. */
export async function getLatestConversation(
  documentId: string,
  signal: AbortSignal,
): Promise<SavedConversation | null> {
  const encoded = encodeURIComponent(documentId)
  const list = await getJson(
    `/documents/${encoded}/conversations?limit=1&has_turns=true`,
    signal,
  )
  if (!isRecord(list) || !Array.isArray(list.items))
    throw new ApiError(INVALID_RESPONSE)
  if (list.items.length === 0) return null
  const summary: unknown = list.items[0]
  if (
    !isRecord(summary) ||
    typeof summary.id !== 'string' ||
    !summary.id.trim() ||
    summary.document_id !== documentId ||
    !Number.isSafeInteger(summary.turn_count) ||
    Number(summary.turn_count) < 1
  )
    throw new ApiError(INVALID_RESPONSE)
  const offset = Math.max(0, Number(summary.turn_count) - HISTORY_PAGE_SIZE)
  const history = await getJson(
    `/conversations/${encodeURIComponent(summary.id)}?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`,
    signal,
  )
  if (
    !isRecord(history) ||
    history.id !== summary.id ||
    !Array.isArray(history.turns)
  )
    throw new ApiError(INVALID_RESPONSE)
  return {
    id: summary.id,
    turns: history.turns.map((turn: unknown) =>
      parseSavedTurn(turn, documentId),
    ),
  }
}
