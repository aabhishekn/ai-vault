import { ApiError, requestJson } from '../../lib/api'
import { isDocument } from './api'

// Statuses the backend lets someone queue again that are worth offering in the UI
// (a document that is merely queued or processing is already moving).
const PROCESSABLE_AGAIN = ['failed', 'extracted']

export function canProcessAgain(status) {
  return PROCESSABLE_AGAIN.includes(status)
}

function messageFor(status, messages) {
  return messages[status] ?? messages.default
}

export async function deleteDocument(id, signal) {
  try {
    // Removes every version, so the document does not reappear as an older one.
    await requestJson(
      `/documents/${encodeURIComponent(id)}?all_versions=true`,
      signal,
      { method: 'DELETE' },
    )
  } catch (error) {
    // Already gone (deleted elsewhere) is the outcome the person wanted.
    if (error instanceof ApiError && error.status === 404) return
    throw new ApiError(
      messageFor(error instanceof ApiError ? error.status : undefined, {
        409: 'This document is still being processed. Try again once processing finishes.',
        default: 'We couldn’t delete this document. Try again.',
      }),
    )
  }
}

export async function reprocessDocument(id, signal) {
  let data
  try {
    data = await requestJson(
      `/documents/${encodeURIComponent(id)}/reprocess`,
      signal,
      { method: 'POST' },
    )
  } catch (error) {
    throw new ApiError(
      messageFor(error instanceof ApiError ? error.status : undefined, {
        404: 'This document could not be found. Close this view and refresh the list.',
        409: 'This document is already being processed or has finished. Refresh its details.',
        429: 'Too many requests right now. Wait a moment and try again.',
        503: 'The processing queue is unavailable. Try again shortly.',
        default: 'We couldn’t queue processing. Try again.',
      }),
    )
  }
  if (!isDocument(data))
    throw new ApiError('The document service returned an unexpected result.')
  return data
}
