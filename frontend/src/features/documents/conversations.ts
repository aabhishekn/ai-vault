import { ApiError, requestJson } from '../../lib/api'
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
