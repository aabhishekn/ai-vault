import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { getDocument, listDocuments, parseDocumentPage } from './api'
import { DOCUMENT_STATUSES } from './types'

const document = {
  id: '27787af5-f007-4689-aae1-4f551946babe',
  filename: 'A real document.pdf',
  content_type: 'application/pdf',
  size_bytes: 129470,
  status: 'embedded',
  created_at: '2026-11-03T18:24:26.616581Z',
}
const page = { items: [document], total: 21, limit: 10, offset: 20 }

describe('document API contract', () => {
  it('accepts the backend response shape and all supported processing states', () => {
    for (const status of DOCUMENT_STATUSES) {
      const response = { ...page, items: [{ ...document, status }] }
      expect(parseDocumentPage(response)).toEqual(response)
    }
  })

  it('accepts an empty document page', () => {
    const empty = { items: [], total: 0, limit: 10, offset: 0 }
    expect(parseDocumentPage(empty)).toEqual(empty)
  })

  it.each([
    { ...page, items: [{ ...document, status: 'unrecognized' }] },
    { ...page, items: [{ ...document, size_bytes: -1 }] },
    { ...page, items: [{ ...document, created_at: 'not a date' }] },
    { ...page, items: [{ ...document, filename: null }] },
    { ...page, total: '21' },
    { ...page, offset: -1 },
    { ...page, limit: 0 },
    { ...page, items: {} },
    null,
  ])('rejects malformed server data before rendering it', (response) => {
    expect(() => parseDocumentPage(response)).toThrow(ApiError)
  })

  it('passes pagination and cancellation through the shared API client', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(page))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(
      listDocuments({ limit: 10, offset: 20, signal }),
    ).resolves.toEqual(page)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/documents?limit=10&offset=20',
      {
        signal,
        headers: { Accept: 'application/json' },
      },
    )
  })

  it('rejects mismatched pagination metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...page, offset: 0 })),
    )
    await expect(
      listDocuments({
        limit: 10,
        offset: 20,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('unexpected page')
  })

  it('does not expose server error details to the screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { detail: 'private database information' },
            { status: 503 },
          ),
        ),
    )
    await expect(
      listDocuments({
        limit: 10,
        offset: 0,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('document service is unavailable')
  })
})

describe('document details API', () => {
  it('fetches the selected document and forwards its cancellation signal', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(document))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(getDocument(document.id, signal)).resolves.toEqual(document)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${document.id}`,
      {
        signal,
        headers: { Accept: 'application/json' },
      },
    )
  })
  it('encodes the identifier as a single path segment', async () => {
    const id = 'unexpected/id?value'
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...document, id }))
    vi.stubGlobal('fetch', fetch)
    await getDocument(id, new AbortController().signal)
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/documents/unexpected%2Fid%3Fvalue',
    )
  })
  it.each([
    null,
    { ...document, id: 'different-document' },
    { ...document, status: 'unknown' },
  ])(
    'rejects malformed or mismatched details instead of showing the wrong document',
    async (data) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
      await expect(
        getDocument(document.id, new AbortController().signal),
      ).rejects.toThrow('unexpected details')
    },
  )
  it('explains when the selected document no longer exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: 'internal lookup' }, { status: 404 }),
        ),
    )
    await expect(
      getDocument(document.id, new AbortController().signal),
    ).rejects.toThrow('could not be found')
  })
  it('keeps server internals out of a details failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { detail: 'private database internals' },
            { status: 503 },
          ),
        ),
    )
    await expect(
      getDocument(document.id, new AbortController().signal),
    ).rejects.toThrow('document service is unavailable')
  })
})
