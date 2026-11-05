import { ApiError, requestJson } from '../../../lib/api'

const isRecord = (value) => typeof value === 'object' && value !== null

// Asks the server to name the document's category (and, if it has none yet, its title).
export async function classifyDocument(id, signal) {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(id)}/classification`,
      signal,
      { method: 'POST' },
    )
    if (
      !isRecord(data) ||
      data.document_id !== id ||
      typeof data.category !== 'string'
    )
      throw new ApiError(
        'The document service returned an unexpected category.',
      )
    return { category: data.category }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409)
        throw new ApiError(
          'Document text is not ready yet. Try again once processing finishes.',
        )
      if (error.status === 429)
        throw new ApiError('Too many AI requests right now. Try again shortly.')
      if (error.status === undefined) throw error
    }
    throw new ApiError('We couldn’t add a category. Please try again.')
  }
}
