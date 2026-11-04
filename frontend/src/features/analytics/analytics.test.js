import { describe, expect, it, vi } from 'vitest'
import {
  getDocumentStatistics,
  getProcessingMetrics,
  parseDocumentStatistics,
  parseProcessingMetrics,
} from './analytics'

const stats = {
  total_documents: 3,
  total_storage_bytes: 388410,
  documents_with_summary: 2,
  total_extracted_pages: 12,
  total_chunks: 12,
  chunks_with_embeddings: 6,
  by_status: {
    queued: 0,
    processing: 0,
    extracted: 2,
    embedded: 1,
    ready: 0,
    failed: 0,
  },
}
const metrics = {
  total_attempts: 2,
  processing: 0,
  succeeded: 1,
  failed: 1,
  success_rate: 0.5,
  average_duration_ms: 129,
  average_success_duration_ms: 100,
  average_failure_duration_ms: 158,
  max_duration_ms: 158,
  observed_embedding_input_tokens: 1240,
}
const signal = () => new AbortController().signal

describe('analytics parsing', () => {
  it('maps document statistics to camelCase', () => {
    expect(parseDocumentStatistics(stats)).toMatchObject({
      totalDocuments: 3,
      totalStorageBytes: 388410,
      chunksWithEmbeddings: 6,
      byStatus: { extracted: 2, embedded: 1 },
    })
  })
  it('maps processing metrics and keeps null aggregates for no attempts', () => {
    expect(parseProcessingMetrics(metrics)).toMatchObject({
      totalAttempts: 2,
      successRate: 0.5,
      maxDurationMs: 158,
    })
    expect(
      parseProcessingMetrics({
        ...metrics,
        total_attempts: 0,
        succeeded: 0,
        failed: 0,
        success_rate: null,
        average_duration_ms: null,
        max_duration_ms: null,
      }),
    ).toMatchObject({ successRate: null, averageDurationMs: null })
  })
  it.each([
    null,
    {},
    { ...stats, total_documents: -1 },
    { ...stats, total_documents: 1.5 },
    { ...stats, total_documents: 4 },
    { ...stats, total_chunks: '12' },
    { ...stats, chunks_with_embeddings: 13 },
    { ...stats, documents_with_summary: 4 },
    { ...stats, by_status: { ...stats.by_status, failed: undefined } },
  ])('rejects malformed statistics', (data) => {
    expect(() => parseDocumentStatistics(data)).toThrow('unexpected statistics')
  })
  it.each([
    null,
    {},
    { ...metrics, total_attempts: 3 },
    { ...metrics, success_rate: 1.5 },
    { ...metrics, average_duration_ms: -1 },
    { ...metrics, max_duration_ms: 'fast' },
    { ...metrics, failed: -1 },
  ])('rejects malformed metrics', (data) => {
    expect(() => parseProcessingMetrics(data)).toThrow('unexpected statistics')
  })
})

describe('analytics requests', () => {
  it('reads each endpoint with GET', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(stats))
      .mockResolvedValueOnce(Response.json(metrics))
    vi.stubGlobal('fetch', fetch)
    await getDocumentStatistics('statistics', signal())
    await getProcessingMetrics('metrics', signal())
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/stats/documents',
      '/api/metrics/processing',
    ])
  })
})
