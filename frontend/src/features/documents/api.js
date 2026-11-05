import { ApiError, getJson } from '../../lib/api'
import { DOCUMENT_STATUSES } from './types'

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function isNonnegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isDocument(value) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.filename === 'string' &&
    value.filename.length > 0 &&
    typeof value.content_type === 'string' &&
    isNonnegativeInteger(value.size_bytes) &&
    value.size_bytes > 0 &&
    DOCUMENT_STATUSES.some((status) => status === value.status) &&
    (value.version_number === undefined ||
      (isNonnegativeInteger(value.version_number) &&
        value.version_number >= 1)) &&
    (value.is_latest === undefined || typeof value.is_latest === 'boolean') &&
    (value.title === undefined ||
      value.title === null ||
      typeof value.title === 'string') &&
    (value.error_message === undefined ||
      value.error_message === null ||
      typeof value.error_message === 'string') &&
    (value.category === undefined ||
      value.category === null ||
      typeof value.category === 'string') &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  )
}

// Validate server data here; components never need to cast unknown JSON.
export function parseDocumentPage(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isDocument) ||
    !isNonnegativeInteger(data.total) ||
    !isNonnegativeInteger(data.offset) ||
    !isNonnegativeInteger(data.limit) ||
    data.limit < 1 ||
    data.limit > 100 ||
    data.items.length > data.limit
  ) {
    throw new ApiError(
      'The document service returned an unexpected list. Please try again.',
    )
  }
  return {
    items: data.items,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  }
}

// `search` narrows the list to documents matching every word (title, file name or category).
export async function listDocuments({ limit, offset, signal, search = '' }) {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  if (search) query.set('q', search)
  const page = parseDocumentPage(await getJson(`/documents?${query}`, signal))
  if (page.limit !== limit || page.offset !== offset) {
    throw new ApiError(
      'The document service returned an unexpected page. Please refresh the list.',
    )
  }
  return page
}

export async function getDocument(id, signal) {
  try {
    const data = await getJson(`/documents/${encodeURIComponent(id)}`, signal)
    if (!isDocument(data) || data.id !== id) {
      throw new ApiError(
        'The document service returned unexpected details. Please try again.',
      )
    }
    return data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        'This document could not be found. Close this view and refresh your document list.',
        404,
      )
    }
    throw error
  }
}
