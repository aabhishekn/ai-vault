import { describe, expect, it, vi } from 'vitest'
import {
  canGenerateInsights,
  generateDocumentInsights,
  getSavedInsights,
} from './insights'

const id = 'insights-document'
const insight = {
  text: 'A useful finding.',
  page_number: 2,
  evidence: 'Supporting text from the document.',
}
const saved = { document_id: id, insights: [insight] }
const document = {
  id,
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 100,
  status: 'embedded',
  created_at: '2026-11-04T06:00:00Z',
}

describe('saved insights API', () => {
  it('loads cited insights using GET without generating content', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(saved))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(getSavedInsights(id, signal)).resolves.toEqual(saved)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${id}/insights`,
      { signal, headers: { Accept: 'application/json' } },
    )
  })
  it('distinguishes a saved empty result from insights not yet generated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...saved, insights: [] })),
    )
    await expect(
      getSavedInsights(id, new AbortController().signal),
    ).resolves.toEqual({ ...saved, insights: [] })
  })
  it('confirms the document exists before returning no saved insights', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json(document))
    vi.stubGlobal('fetch', fetch)
    await expect(
      getSavedInsights(id, new AbortController().signal),
    ).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('reports a deleted document instead of presenting an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json({}, { status: 404 })),
        ),
    )
    await expect(
      getSavedInsights(id, new AbortController().signal),
    ).rejects.toThrow('could not be found')
  })
  it.each([
    null,
    {},
    { ...saved, document_id: 'another-document' },
    { ...saved, insights: {} },
    { ...saved, insights: [null] },
    ...[
      { ...insight, page_number: 0 },
      { ...insight, page_number: 1.5 },
      { ...insight, page_number: '2' },
      { ...insight, evidence: '' },
      { ...insight, text: ' ' },
      { ...insight, evidence: null },
    ].map((item) => ({ ...saved, insights: [item] })),
  ])('rejects invalid citations and mismatched results', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(
      getSavedInsights(id, new AbortController().signal),
    ).rejects.toThrow('unexpected insights')
  })
  it('does not expose backend error details or call generation on failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ detail: 'private database details' }, { status: 503 }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      getSavedInsights(id, new AbortController().signal),
    ).rejects.toThrow('document service is unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('insight generation API', () => {
  it('posts once with no body and validates source citations', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(saved))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(generateDocumentInsights(id, signal)).resolves.toEqual(saved)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${id}/insights`,
      {
        method: 'POST',
        signal,
        headers: { Accept: 'application/json' },
      },
    )
  })
  it('accepts a saved empty result without treating it as ungenerated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...saved, insights: [] })),
    )
    await expect(
      generateDocumentInsights(id, new AbortController().signal),
    ).resolves.toEqual({ ...saved, insights: [] })
  })
  it.each([
    [404, 'document could not be found'],
    [409, 'text is not ready or has changed'],
    [413, 'insight size limit'],
    [502, 'couldn’t confirm insight generation'],
    [503, 'couldn’t confirm insight generation'],
  ])('reports HTTP %i safely without retrying', async (status, message) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ detail: 'private provider details' }, { status }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      generateDocumentInsights(id, new AbortController().signal),
    ).rejects.toThrow(message)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    null,
    { ...saved, document_id: 'wrong-document' },
    { ...saved, insights: [{ ...insight, page_number: 0 }] },
    { ...saved, insights: [{ ...insight, evidence: '' }] },
  ])('rejects an invalid generated result as unconfirmed', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(
      generateDocumentInsights(id, new AbortController().signal),
    ).rejects.toThrow('Refresh insights')
  })
  it('does not retry after a disconnect', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    await expect(
      generateDocumentInsights(id, new AbortController().signal),
    ).rejects.toThrow('Refresh insights')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['extracted', 'embedded', 'ready'])(
    'allows generation with usable text: %s',
    (status) => {
      expect(canGenerateInsights(status)).toBe(true)
    },
  )
  it.each(['queued', 'processing', 'failed'])(
    'blocks generation without usable text: %s',
    (status) => {
      expect(canGenerateInsights(status)).toBe(false)
    },
  )
})
