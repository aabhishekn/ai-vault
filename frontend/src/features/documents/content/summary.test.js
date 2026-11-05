import { describe, expect, it, vi } from 'vitest'
import {
  canGenerateSummary,
  generateDocumentSummary,
  getSavedSummary,
} from './summary'

const id = 'summary-document'
const document = {
  id,
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 100,
  status: 'embedded',
  created_at: '2026-11-04T06:00:00Z',
}
const summary = {
  document_id: id,
  summary: 'First paragraph.\n\nSecond paragraph.',
}

describe('saved summary API', () => {
  it('reads the saved result using GET without generating content', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(summary))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(getSavedSummary(id, signal)).resolves.toEqual(summary)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${id}/summary`,
      { signal, headers: { Accept: 'application/json' } },
    )
  })
  it('only reports no summary after confirming the document exists', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { detail: 'Summary has not been generated' },
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(Response.json(document))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(getSavedSummary(id, signal)).resolves.toBeNull()
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/documents/${id}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
  })
  it('reports a deleted document as an error instead of an empty summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            Response.json({ detail: 'Document not found' }, { status: 404 }),
          ),
        ),
    )
    await expect(
      getSavedSummary(id, new AbortController().signal),
    ).rejects.toThrow('document could not be found')
  })
  it.each([
    null,
    {},
    { ...summary, document_id: 'another-document' },
    { ...summary, summary: '' },
    { ...summary, summary: '  ' },
    { ...summary, summary: 123 },
  ])('rejects invalid or mismatched saved results', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(
      getSavedSummary(id, new AbortController().signal),
    ).rejects.toThrow('unexpected summary')
  })
  it('keeps a server failure separate from an empty summary', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ detail: 'private SQL details' }, { status: 503 }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      getSavedSummary(id, new AbortController().signal),
    ).rejects.toThrow('document service is unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('propagates a connection failure instead of silently showing an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Connection failed')),
    )
    await expect(
      getSavedSummary(id, new AbortController().signal),
    ).rejects.toThrow('Connection failed')
  })
})

describe('summary generation API', () => {
  it('posts once without a request body and validates the saved result', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(summary))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(generateDocumentSummary(id, signal)).resolves.toEqual(summary)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${id}/summary`,
      {
        method: 'POST',
        signal,
        headers: { Accept: 'application/json' },
      },
    )
  })
  it.each([
    [404, 'document could not be found'],
    [409, 'text is not ready or has changed'],
    [413, 'summary size limit'],
    [502, 'couldn’t confirm summary generation'],
    [503, 'couldn’t confirm summary generation'],
  ])(
    'provides safe feedback for HTTP %i without retrying',
    async (status, message) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: 'private provider details' }, { status }),
        )
      vi.stubGlobal('fetch', fetch)
      await expect(
        generateDocumentSummary(id, new AbortController().signal),
      ).rejects.toThrow(message)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )
  it('does not repeat a request when the connection fails after submission', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    await expect(
      generateDocumentSummary(id, new AbortController().signal),
    ).rejects.toThrow('Check saved summary')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('treats a mismatched result as unconfirmed rather than showing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...summary, document_id: 'another-document' }),
        ),
    )
    await expect(
      generateDocumentSummary(id, new AbortController().signal),
    ).rejects.toThrow('couldn’t confirm')
  })
  it.each(['extracted', 'embedded', 'ready'])(
    'allows generation after text is available: %s',
    (status) => {
      expect(canGenerateSummary(status)).toBe(true)
    },
  )
  it.each(['queued', 'processing', 'failed'])(
    'prevents generation before usable text: %s',
    (status) => {
      expect(canGenerateSummary(status)).toBe(false)
    },
  )
})
