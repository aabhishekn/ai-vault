import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { canProcessAgain, deleteDocument, reprocessDocument } from './manage'

const document = {
  id: 'doc-1',
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 10,
  status: 'queued',
  created_at: '2026-11-04T06:00:00Z',
}

const signal = new AbortController().signal

function respond(response) {
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('document management API', () => {
  it('offers processing again only for failed or text-only documents', () => {
    expect(
      ['queued', 'processing', 'extracted', 'embedded', 'ready', 'failed']
        .filter(canProcessAgain)
        .sort(),
    ).toEqual(['extracted', 'failed'])
  })

  it('deletes every version with a bodiless 204 response', async () => {
    const fetch = respond(new Response(null, { status: 204 }))
    await expect(deleteDocument('doc 1', signal)).resolves.toBeUndefined()
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/documents/doc%201?all_versions=true')
    expect(options.method).toBe('DELETE')
  })

  it('treats a document that is already gone as deleted', async () => {
    respond(Response.json({ detail: 'Document not found' }, { status: 404 }))
    await expect(deleteDocument('doc-1', signal)).resolves.toBeUndefined()
  })

  it('explains a delete refused while processing, without leaking server text', async () => {
    respond(Response.json({ detail: 'internal details' }, { status: 409 }))
    const error = await deleteDocument('doc-1', signal).catch(
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toMatch(/still being processed/)
    expect(error.message).not.toMatch(/internal/)
  })

  it('reports a failed delete and survives a network error', async () => {
    respond(new Response('boom', { status: 500 }))
    await expect(deleteDocument('doc-1', signal)).rejects.toThrow(
      /couldn’t delete/,
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(deleteDocument('doc-1', signal)).rejects.toThrow(
      /couldn’t delete/,
    )
  })

  it('queues processing again and returns the document', async () => {
    const fetch = respond(Response.json(document, { status: 202 }))
    await expect(reprocessDocument('doc-1', signal)).resolves.toEqual(document)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/documents/doc-1/reprocess')
    expect(options.method).toBe('POST')
  })

  it.each([
    [404, /could not be found/],
    [409, /already being processed or has finished/],
    [429, /Too many requests/],
    [503, /queue is unavailable/],
    [500, /couldn’t queue processing/],
  ])('maps reprocess status %i to a safe message', async (status, message) => {
    respond(Response.json({ detail: 'x' }, { status }))
    await expect(reprocessDocument('doc-1', signal)).rejects.toThrow(message)
  })

  it('rejects an unexpected reprocess response', async () => {
    respond(Response.json({ nope: true }, { status: 202 }))
    await expect(reprocessDocument('doc-1', signal)).rejects.toThrow(
      /unexpected result/,
    )
  })
})
