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

export async function sendMessage(
  documentId: string,
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
      answer: parseAnswer(data.response, documentId, normalized),
    }
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
