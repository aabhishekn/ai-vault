import { ApiError, getJson } from '../../lib/api'
import {
  DOCUMENT_STATUSES,
  type DocumentPage,
  type VaultDocument,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isDocument(value: unknown): value is VaultDocument {
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
    (value.category === undefined ||
      value.category === null ||
      typeof value.category === 'string') &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) &&
        value.tags.every((tag) => typeof tag === 'string'))) &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at))
  )
}

// Validate server data here; components never need to cast unknown JSON.
export function parseDocumentPage(data: unknown): DocumentPage {
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

export type DocumentFilter = { category?: string; tag?: string }

type ListDocumentsOptions = {
  limit: number
  offset: number
  signal: AbortSignal
  filter?: DocumentFilter
}

export async function listDocuments({
  limit,
  offset,
  signal,
  filter = {},
}: ListDocumentsOptions): Promise<DocumentPage> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  if (filter.category) query.set('category', filter.category)
  if (filter.tag) query.set('tag', filter.tag)
  const page = parseDocumentPage(await getJson(`/documents?${query}`, signal))
  if (page.limit !== limit || page.offset !== offset) {
    throw new ApiError(
      'The document service returned an unexpected page. Please refresh the list.',
    )
  }
  return page
}

export async function getDocument(
  id: string,
  signal: AbortSignal,
): Promise<VaultDocument> {
  try {
    const data = await getJson(`/documents/${encodeURIComponent(id)}`, signal)
    if (!isDocument(data) || data.id !== id) {
      throw new ApiError(
        'The document service returned unexpected details. Please try again.',
      )
    }
    return data
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        'This document could not be found. Close this view and refresh your document list.',
        404,
      )
    }
    throw error
  }
}
