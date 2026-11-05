import { ApiError, requestJson } from '../../../lib/api'

export const MAX_COMPARED = 5
export const MAX_COMPARISON_FOCUS = 200

const INVALID =
  'The document service returned an invalid comparison. Please try again.'

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

const isText = (value) => typeof value === 'string' && value.trim().length > 0

function isPosition(value) {
  return (
    isRecord(value) &&
    isText(value.document_id) &&
    isText(value.filename) &&
    isText(value.statement)
  )
}

export function parseComparison(data) {
  if (
    !isRecord(data) ||
    !isText(data.overview) ||
    !Array.isArray(data.documents) ||
    data.documents.length < 2 ||
    !data.documents.every(
      (item) => isRecord(item) && isText(item.id) && isText(item.filename),
    ) ||
    !Array.isArray(data.similarities) ||
    !data.similarities.every(isText) ||
    !Array.isArray(data.differences) ||
    !data.differences.every(
      (item) =>
        isRecord(item) &&
        isText(item.topic) &&
        Array.isArray(item.positions) &&
        item.positions.every(isPosition),
    )
  )
    throw new ApiError(INVALID)
  return {
    documents: data.documents,
    focus: typeof data.focus === 'string' ? data.focus : null,
    overview: data.overview,
    similarities: data.similarities,
    differences: data.differences,
    cached: data.cached === true,
  }
}

function toError(error) {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return new ApiError(
        'One of these documents could not be found. Refresh the list and try again.',
      )
    if (error.status === 409)
      return new ApiError(
        'All documents must finish processing before they can be compared.',
      )
    if (error.status === 422)
      return new ApiError(
        'Choose between 2 and 5 documents and keep the focus within 200 characters.',
      )
    if (error.status === 429)
      return new ApiError(
        'Too many AI requests right now. Wait a moment and try again.',
      )
    if (error.status === undefined) return error
  }
  return new ApiError(
    'We couldn’t complete the comparison. Check your connection and try again.',
  )
}

export async function compareDocuments(documentIds, focus, signal) {
  try {
    const trimmed = focus.trim()
    const data = await requestJson('/comparisons', signal, {
      method: 'POST',
      json: {
        document_ids: documentIds,
        ...(trimmed ? { focus: trimmed } : {}),
      },
    })
    return parseComparison(data)
  } catch (error) {
    throw toError(error)
  }
}
