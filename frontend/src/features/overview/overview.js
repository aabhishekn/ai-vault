import { ApiError, getJson } from '../../lib/api'
import { DOCUMENT_STATUSES } from '../documents/status'

const unexpected = () =>
  new ApiError(
    'The document service returned unexpected statistics. Please try again.',
  )

function asRecord(value) {
  if (typeof value !== 'object' || value === null) throw unexpected()
  return value
}

function count(source, key) {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw unexpected()
  return value
}

function nullableNumber(source, key, max = Infinity) {
  const value = source[key]
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  )
    throw unexpected()
  return value
}

export function parseDocumentStatistics(data) {
  const source = asRecord(data)
  const statuses = asRecord(source.by_status)
  const byStatus = Object.fromEntries(
    DOCUMENT_STATUSES.map((status) => [status, count(statuses, status)]),
  )
  const totalDocuments = count(source, 'total_documents')
  const statusTotal = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
  const chunks = count(source, 'total_chunks')
  const embedded = count(source, 'chunks_with_embeddings')
  const summaries = count(source, 'documents_with_summary')
  if (
    statusTotal !== totalDocuments ||
    embedded > chunks ||
    summaries > totalDocuments
  )
    throw unexpected()
  return {
    totalDocuments,
    totalStorageBytes: count(source, 'total_storage_bytes'),
    documentsWithSummary: summaries,
    totalExtractedPages: count(source, 'total_extracted_pages'),
    totalChunks: chunks,
    chunksWithEmbeddings: embedded,
    byStatus,
  }
}

export function parseProcessingMetrics(data) {
  const source = asRecord(data)
  const attempts = count(source, 'total_attempts')
  const processing = count(source, 'processing')
  const succeeded = count(source, 'succeeded')
  const failed = count(source, 'failed')
  if (processing + succeeded + failed !== attempts) throw unexpected()
  return {
    totalAttempts: attempts,
    processing,
    succeeded,
    failed,
    successRate: nullableNumber(source, 'success_rate', 1),
    averageDurationMs: nullableNumber(source, 'average_duration_ms'),
    maxDurationMs: nullableNumber(source, 'max_duration_ms'),
    observedEmbeddingInputTokens: count(
      source,
      'observed_embedding_input_tokens',
    ),
  }
}

export async function getDocumentStatistics(_key, signal) {
  return parseDocumentStatistics(await getJson('/stats/documents', signal))
}

export async function getProcessingMetrics(_key, signal) {
  return parseProcessingMetrics(await getJson('/metrics/processing', signal))
}
