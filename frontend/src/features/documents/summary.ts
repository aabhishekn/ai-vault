import { ApiError, getJson } from '../../lib/api'
import { getDocument } from './api'

export type SavedSummary = { document_id: string; summary: string }

export async function getSavedSummary(
  id: string,
  signal: AbortSignal,
): Promise<SavedSummary | null> {
  let data: unknown
  try {
    data = await getJson(`/documents/${encodeURIComponent(id)}/summary`, signal)
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    // The API uses 404 both for a missing document and for an absent summary.
    // Confirm the document still exists before presenting an empty state.
    await getDocument(id, signal)
    return null
  }
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
