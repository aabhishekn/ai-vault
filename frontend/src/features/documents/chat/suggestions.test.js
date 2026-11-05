import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api'
import { getSuggestedQuestions } from './suggestions'

afterEach(() => vi.unstubAllGlobals())
const signal = () => new AbortController().signal

describe('suggested questions API', () => {
  it('posts to the document and returns the questions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ questions: ['What is X?', 'Why Y?'] }))
    vi.stubGlobal('fetch', fetch)
    await expect(getSuggestedQuestions('doc a', signal())).resolves.toEqual([
      'What is X?',
      'Why Y?',
    ])
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/documents/doc%20a/suggested-questions',
    )
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })

  it.each([
    {},
    { questions: [] },
    { questions: [1] },
    { questions: [' '] },
    null,
  ])('rejects an invalid response %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(getSuggestedQuestions('d', signal())).rejects.toThrow(
      /invalid suggestions/,
    )
  })

  it.each([
    [409, /summary or insights first/],
    [429, /Too many AI requests/],
    [500, /couldn’t suggest/],
  ])('explains status %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    )
    const error = await getSuggestedQuestions('d', signal()).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toMatch(message)
  })
})
