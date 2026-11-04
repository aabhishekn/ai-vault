import {
  canGenerateSummary,
  generateDocumentSummary,
  getSavedSummary,
} from './summary'
import type { DocumentStatus } from './types'
import { useGeneratedDocumentContent } from './useGeneratedDocumentContent'

const summaryApi = {
  load: getSavedSummary,
  generate: generateDocumentSummary,
  loadError:
    'We couldn’t load the saved summary. Check your connection and try again.',
  generationError:
    'Summary generation could not be confirmed. Refresh the summary before trying again.',
}

export function useDocumentSummary(id: string, status: DocumentStatus) {
  return useGeneratedDocumentContent(id, canGenerateSummary(status), summaryApi)
}
