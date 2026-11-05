import { ApiError } from '../../lib/api'

export const MAX_QUESTION_LENGTH = 2000

export function validateQuestion(question) {
  if (!question.trim()) return 'Enter a question about this document.'
  if (question.trim().length > MAX_QUESTION_LENGTH)
    return 'Keep your question within 2,000 characters.'
  return null
}

export function canAskDocument(status) {
  return status === 'embedded' || status === 'ready'
}

function isCitation(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source_number' in value &&
    Number.isSafeInteger(value.source_number) &&
    Number(value.source_number) > 0 &&
    (!('filename' in value) ||
      value.filename == null ||
      typeof value.filename === 'string') &&
    (!('title' in value) ||
      value.title == null ||
      typeof value.title === 'string') &&
    'page_number' in value &&
    Number.isSafeInteger(value.page_number) &&
    Number(value.page_number) > 0 &&
    'chunk_id' in value &&
    typeof value.chunk_id === 'string' &&
    Boolean(value.chunk_id.trim()) &&
    'text' in value &&
    typeof value.text === 'string' &&
    Boolean(value.text.trim())
  )
}

export function parseAnswer(data, id, question) {
  const invalid = () =>
    new ApiError(
      'The document service returned an invalid answer or citations. Please try again.',
    )
  if (
    typeof data !== 'object' ||
    data === null ||
    !('document_id' in data) ||
    data.document_id !== id ||
    !('question' in data) ||
    data.question !== question ||
    !('answer' in data) ||
    typeof data.answer !== 'string' ||
    !data.answer.trim() ||
    !('insufficient_evidence' in data) ||
    typeof data.insufficient_evidence !== 'boolean' ||
    !('citations' in data) ||
    !Array.isArray(data.citations) ||
    !data.citations.every(isCitation)
  )
    throw invalid()

  const labels = new Set(
    data.citations.map((citation) => citation.source_number),
  )
  const inlineLabels = new Set(
    [...data.answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])),
  )
  if (labels.size !== data.citations.length) throw invalid()
  if (data.insufficient_evidence) {
    if (labels.size || inlineLabels.size) throw invalid()
  } else if (
    !labels.size ||
    labels.size !== inlineLabels.size ||
    [...inlineLabels].some((label) => !labels.has(label))
  ) {
    throw invalid()
  }
  return {
    document_id: id,
    question,
    answer: data.answer,
    insufficient_evidence: data.insufficient_evidence,
    citations: data.citations,
  }
}

export function toAnswerError(error) {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return new ApiError(
        'This document could not be found. Close this view and refresh the document list.',
      )
    if (error.status === 409)
      return new ApiError(
        'This document is not ready for questions, or the conversation changed. Close this view, open the document again and retry.',
      )
    if (error.status === 422)
      return new ApiError(
        'The question was not accepted. Enter a question within 2,000 characters.',
      )
    if (error.status === undefined) return error
  }
  return new ApiError(
    'We couldn’t complete your answer. Check your connection and try again when the document service is available.',
  )
}
