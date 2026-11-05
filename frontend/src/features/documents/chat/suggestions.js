import { ApiError, requestJson } from '../../../lib/api'

const INVALID_RESPONSE =
  'The document service returned invalid suggestions. Please try again.'

function toSuggestionError(error) {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return new ApiError(
        'Generate this document’s summary or insights first, then suggestions will be available.',
      )
    if (error.status === 429)
      return new ApiError(
        'Too many AI requests right now. Wait a moment and try again.',
      )
    if (error.status === undefined) return error
  }
  return new ApiError(
    'We couldn’t suggest questions. Check your connection and try again.',
  )
}

// Suggestions come from the saved summary and insights; the server caches them,
// so asking again for the same content makes no new AI request.
export async function getSuggestedQuestions(documentId, signal) {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(documentId)}/suggested-questions`,
      signal,
      { method: 'POST' },
    )
    if (
      typeof data !== 'object' ||
      data === null ||
      !('questions' in data) ||
      !Array.isArray(data.questions) ||
      data.questions.length === 0 ||
      !data.questions.every(
        (item) => typeof item === 'string' && item.trim() !== '',
      )
    )
      throw new ApiError(INVALID_RESPONSE)
    return data.questions
  } catch (error) {
    throw toSuggestionError(error)
  }
}
