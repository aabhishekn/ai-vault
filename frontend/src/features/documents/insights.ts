import { ApiError } from '../../lib/api'
import { getSavedDocumentContent } from './savedContent'

export type DocumentInsight = {
  text: string
  page_number: number
  evidence: string
}
export type SavedInsights = { document_id: string; insights: DocumentInsight[] }

function isInsight(data: unknown): data is DocumentInsight {
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

export async function getSavedInsights(
  id: string,
  signal: AbortSignal,
): Promise<SavedInsights | null> {
  const data = await getSavedDocumentContent(id, 'insights', signal)
  if (data === undefined) return null
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
