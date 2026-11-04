import { ApiError, getJson } from '../../lib/api'

export type DocumentVersion = {
  id: string
  version_number: number
  filename: string
  size_bytes: number
  status: string
  is_latest: boolean
  created_at: string
}

export async function getVersions(
  id: string,
  signal: AbortSignal,
): Promise<DocumentVersion[]> {
  const data = await getJson(
    `/documents/${encodeURIComponent(id)}/versions`,
    signal,
  )
  if (
    typeof data !== 'object' ||
    data === null ||
    !('versions' in data) ||
    !Array.isArray(data.versions)
  )
    throw new ApiError('The document service returned unexpected versions.')
  return data.versions.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !('version_number' in item) ||
      typeof item.version_number !== 'number' ||
      !('filename' in item) ||
      typeof item.filename !== 'string' ||
      !('size_bytes' in item) ||
      typeof item.size_bytes !== 'number' ||
      !('status' in item) ||
      typeof item.status !== 'string' ||
      !('is_latest' in item) ||
      typeof item.is_latest !== 'boolean' ||
      !('created_at' in item) ||
      typeof item.created_at !== 'string'
    )
      throw new ApiError('The document service returned unexpected versions.')
    return {
      id: item.id,
      version_number: item.version_number,
      filename: item.filename,
      size_bytes: item.size_bytes,
      status: item.status,
      is_latest: item.is_latest,
      created_at: item.created_at,
    }
  })
}
