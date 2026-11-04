import { ApiError, getJson, requestJson } from '../../lib/api'

export type Classification = { category: string; tags: string[] }
export type TagsOverview = {
  categories: { category: string; count: number }[]
  tags: { tag: string; count: number }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function parseCounts<K extends string>(
  value: unknown,
  key: K,
): ({ count: number } & Record<K, string>)[] {
  if (!Array.isArray(value)) throw new ApiError('Unexpected tag list.')
  return value.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item[key] !== 'string' ||
      typeof item.count !== 'number'
    )
      throw new ApiError('Unexpected tag list.')
    return { [key]: item[key], count: item.count } as {
      count: number
    } & Record<K, string>
  })
}

export async function getTagsOverview(
  signal: AbortSignal,
): Promise<TagsOverview> {
  const data = await getJson('/tags', signal)
  if (!isRecord(data)) throw new ApiError('Unexpected tag list.')
  return {
    categories: parseCounts(data.categories, 'category'),
    tags: parseCounts(data.tags, 'tag'),
  }
}

export async function classifyDocument(
  id: string,
  signal: AbortSignal,
): Promise<Classification> {
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
      !data.tags.every((tag): tag is string => typeof tag === 'string')
    )
      throw new ApiError('The document service returned unexpected tags.')
    return { category: data.category, tags: data.tags }
  } catch (error: unknown) {
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
