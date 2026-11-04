import { ApiError, getJson } from '../../lib/api'
import { getDocument } from './api'

export async function getSavedDocumentContent(
  id: string,
  kind: 'summary' | 'insights',
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await getJson(`/documents/${encodeURIComponent(id)}/${kind}`, signal)
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    // These endpoints use 404 for missing content and for a missing document.
    await getDocument(id, signal)
    return undefined
  }
}
