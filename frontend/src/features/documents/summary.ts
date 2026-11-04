import { ApiError, requestJson } from '../../lib/api'
import { getSavedDocumentContent } from './savedContent'
import type { DocumentStatus } from './types'

export type SavedSummary = { document_id: string; summary: string }

export async function getSavedSummary(
  id: string,
  signal: AbortSignal,
): Promise<SavedSummary | null> {
  const data = await getSavedDocumentContent(id, 'summary', signal)
  if (data === undefined) return null
  return parseSummary(data, id)
}

function parseSummary(data: unknown, id: string): SavedSummary {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('document_id' in data) ||
    data.document_id !== id ||
    !('summary' in data) ||
    typeof data.summary !== 'string' ||
    !data.summary.trim()
  ) {
    throw new ApiError(
      'The document service returned an unexpected summary. Please try again.',
    )
  }
  return { document_id: id, summary: data.summary }
}

export function canGenerateSummary(status: DocumentStatus): boolean {
  return status === 'extracted' || status === 'embedded' || status === 'ready'
}

export async function generateDocumentSummary(
  id: string,
  signal: AbortSignal,
): Promise<SavedSummary> {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(id)}/summary`,
      signal,
      { method: 'POST' },
    )
    return parseSummary(data, id)
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 404)
        throw new ApiError(
          'This document could not be found. Close this view and refresh the document list.',
        )
      if (error.status === 409)
        throw new ApiError(
          'Document text is not ready or has changed. Refresh document details and check for a saved summary before trying again.',
        )
      if (error.status === 413)
        throw new ApiError(
          'This document exceeds the current summary size limit. Try a shorter document.',
        )
    }
    // The server can finish saving a summary after a timeout or disconnect.
    // Never retry a generation request automatically.
    throw new ApiError(
      'We couldn’t confirm summary generation. Refresh the summary to check for a saved result before generating again.',
    )
  }
}
