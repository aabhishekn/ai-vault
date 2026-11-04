import { ApiError, getJson, requestJson } from '../../lib/api'

const isRecord = (value) => typeof value === 'object' && value !== null

function parseCounts(value, key) {
  if (!Array.isArray(value)) throw new ApiError('Unexpected tag list.')
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item[key] !== 'string' ||
      typeof item.count !== 'number'
    )
      throw new ApiError('Unexpected tag list.')
    return { [key]: item[key], count: item.count }
  })
}

export async function getTagsOverview(signal) {
  const data = await getJson('/tags', signal)
  if (!isRecord(data)) throw new ApiError('Unexpected tag list.')
  return {
    categories: parseCounts(data.categories, 'category'),
    tags: parseCounts(data.tags, 'tag'),
  }
}

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
      typeof data.category !== 'string' ||
      !Array.isArray(data.tags) ||
      !data.tags.every((tag) => typeof tag === 'string')
    )
      throw new ApiError('The document service returned unexpected tags.')
    return { category: data.category, tags: data.tags }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409)
        throw new ApiError(
          'Document text is not ready yet. Refresh details once processing finishes.',
        )
      if (error.status === 429)
        throw new ApiError('Too many AI requests right now. Try again shortly.')
      if (error.status === undefined) throw error
    }
    throw new ApiError('We couldn’t add tags. Please try again.')
  }
}
