import { describe, expect, it, vi } from 'vitest'
import { compareDocuments, parseComparison } from './comparison'

const valid = {
  documents: [
    { id: 'a', filename: 'a.pdf', version_number: 1 },
    { id: 'b', filename: 'b.pdf', version_number: 2 },
  ],
  focus: null,
  overview: 'They differ on price.',
  similarities: ['Both annual.'],
  differences: [
    {
      topic: 'Price',
      positions: [
        { document_id: 'a', filename: 'a.pdf', statement: '5' },
        { document_id: 'b', filename: 'b.pdf', statement: '9' },
      ],
    },
  ],
  cached: true,
}

describe('comparison responses', () => {
  it('accepts a complete comparison', () => {
    const parsed = parseComparison(valid)
    expect(parsed.differences[0].positions).toHaveLength(2)
    expect(parsed.cached).toBe(true)
  })
  it.each([
    null,
    { ...valid, overview: ' ' },
    { ...valid, documents: [valid.documents[0]] },
    { ...valid, similarities: [1] },
    {
      ...valid,
      differences: [{ topic: 'x', positions: [{ statement: 's' }] }],
    },
  ])('rejects a malformed comparison %#', (data) => {
    expect(() => parseComparison(data)).toThrow('invalid comparison')
  })
})

describe('compareDocuments', () => {
  it('posts the ids and only sends a focus when there is one', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(valid)))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await compareDocuments(['a', 'b'], '  ', signal)
    await compareDocuments(['a', 'b'], ' price ', signal)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      document_ids: ['a', 'b'],
    })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      document_ids: ['a', 'b'],
      focus: 'price',
    })
  })
  it.each([
    [409, 'finish processing'],
    [422, 'between 2 and 5'],
    [429, 'Too many AI requests'],
  ])('explains HTTP %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status })),
    )
    await expect(
      compareDocuments(['a', 'b'], '', new AbortController().signal),
    ).rejects.toThrow(message)
  })
})
