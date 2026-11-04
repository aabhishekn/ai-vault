import {
  canGenerateInsights,
  generateDocumentInsights,
  getSavedInsights,
} from './insights'
import type { DocumentStatus } from './types'
import { useGeneratedDocumentContent } from './useGeneratedDocumentContent'

const insightsApi = {
  load: getSavedInsights,
  generate: generateDocumentInsights,
  loadError:
    'We couldn’t load the saved insights. Check your connection and try again.',
  generationError:
    'Insight generation could not be confirmed. Refresh insights before trying again.',
}

export function useDocumentInsights(id: string, status: DocumentStatus) {
  return useGeneratedDocumentContent(
    id,
    canGenerateInsights(status),
    insightsApi,
  )
}
