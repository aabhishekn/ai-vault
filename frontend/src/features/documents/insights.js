import { ApiError, requestJson } from '../../lib/api'
import { getSavedDocumentContent } from './savedContent'

function isInsight(data) {
  return (
    typeof data === 'object' &&
    data !== null &&
    'text' in data &&
    typeof data.text === 'string' &&
    Boolean(data.text.trim()) &&
    'evidence' in data &&
    typeof data.evidence === 'string' &&
    Boolean(data.evidence.trim()) &&
    'page_number' in data &&
    typeof data.page_number === 'number' &&
    Number.isSafeInteger(data.page_number) &&
    data.page_number > 0
  )
}

export async function getSavedInsights(id, signal) {
  const data = await getSavedDocumentContent(id, 'insights', signal)
  if (data === undefined) return null
  return parseInsights(data, id)
}

function parseInsights(data, id) {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('document_id' in data) ||
    data.document_id !== id ||
    !('insights' in data) ||
    !Array.isArray(data.insights) ||
    !data.insights.every(isInsight)
  ) {
    throw new ApiError(
      'The document service returned unexpected insights. Please try again.',
    )
  }
  return { document_id: id, insights: data.insights }
}

export function canGenerateInsights(status) {
  return status === 'extracted' || status === 'embedded' || status === 'ready'
}

export async function generateDocumentInsights(id, signal) {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(id)}/insights`,
      signal,
      { method: 'POST' },
    )
    return parseInsights(data, id)
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404)
        throw new ApiError(
          'This document could not be found. Close this view and refresh the document list.',
        )
      if (error.status === 409)
        throw new ApiError(
          'Document text is not ready or has changed. Refresh document details and check for saved insights before trying again.',
        )
      if (error.status === 413)
        throw new ApiError(
          'This document exceeds the current insight size limit. Try a shorter document.',
        )
    }
    // A disconnect can happen after the server saves the result. Do not retry.
    throw new ApiError(
      'We couldn’t confirm insight generation. Refresh insights to check for a saved result before generating again.',
    )
  }
}
