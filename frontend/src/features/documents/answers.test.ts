import { describe, expect, it, vi } from 'vitest'
import { askDocument, canAskDocument, validateQuestion } from './answers'

const id = 'document-a'
const question = 'What is required?'
const citation = {
  source_number: 1,
  page_number: 2,
  chunk_id: 'chunk-a',
  text: 'Python is required.',
}
const answer = {
  document_id: id,
  question,
  answer: 'Python is required [1].',
  insufficient_evidence: false,
  citations: [citation],
}

describe('document answers API', () => {
  it('posts trimmed JSON with the expected headers, retrieval limit, and abort signal', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(answer))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(askDocument(id, `  ${question}  `, signal)).resolves.toEqual(
      answer,
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/documents/${id}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question, top_k: 3 }),
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })
  })
  it('accepts an explicit insufficient-evidence answer without sources', async () => {
    const insufficient = {
      ...answer,
      insufficient_evidence: true,
      answer: 'Not enough evidence.',
      citations: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(insufficient)),
    )
    await expect(
      askDocument(id, question, new AbortController().signal),
    ).resolves.toEqual(insufficient)
  })
  it.each([
    null,
    {},
    { ...answer, document_id: 'another-document' },
    { ...answer, question: 'Another question' },
    { ...answer, answer: ' ' },
    { ...answer, insufficient_evidence: 'false' },
    { ...answer, citations: [] },
    { ...answer, citations: [null] },
    { ...answer, citations: [citation, citation] },
    { ...answer, answer: 'Unsupported answer [2].' },
    { ...answer, answer: 'No citation labels.' },
    { ...answer, insufficient_evidence: true },
    ...[
      { ...citation, source_number: 0 },
      { ...citation, page_number: 1.5 },
      { ...citation, text: ' ' },
      { ...citation, chunk_id: '' },
      { ...citation, page_number: '2' },
    ].map((item) => ({ ...answer, citations: [item] })),
  ])(
    'rejects mismatched answers and unsupported or malformed citations',
    async (data) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
      await expect(
        askDocument(id, question, new AbortController().signal),
      ).rejects.toThrow('invalid answer or citations')
    },
  )
  it.each([
    [404, 'could not be found'],
    [409, 'not ready for questions'],
    [422, 'not accepted'],
    [502, 'couldn’t complete'],
    [503, 'couldn’t complete'],
  ])('handles HTTP %i safely without retrying', async (status, message) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ detail: 'private provider details' }, { status }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      askDocument(id, question, new AbortController().signal),
    ).rejects.toThrow(message)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not retry a failed connection', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    await expect(
      askDocument(id, question, new AbortController().signal),
    ).rejects.toThrow('couldn’t complete')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['', '  ', 'x'.repeat(2001)])(
    'rejects invalid questions before sending a request',
    async (invalid) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(
        askDocument(id, invalid, new AbortController().signal),
      ).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it('accepts the 2,000-character boundary', () => {
    expect(validateQuestion('x'.repeat(2000))).toBeNull()
  })
  it.each(['embedded', 'ready'] as const)(
    'allows questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(true)
    },
  )
  it.each(['queued', 'processing', 'extracted', 'failed'] as const)(
    'blocks questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(false)
    },
  )
})
