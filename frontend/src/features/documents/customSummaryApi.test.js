import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { DEFAULT_OPTIONS, generateCustomSummary } from './customSummaryApi'

afterEach(() => vi.unstubAllGlobals())
const signal = () => new AbortController().signal
const ok = (extra = {}) =>
  Response.json({
    document_id: 'd',
    summary: 'Short.',
    cached: false,
    ...extra,
  })

describe('custom summary API', () => {
  it('posts the chosen options and returns the summary', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ cached: true }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      generateCustomSummary(
        'd',
        { length: 'short', tone: 'formal', focus: '  risks ' },
        signal(),
      ),
    ).resolves.toEqual({ summary: 'Short.', cached: true })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/documents/d/summary/custom')
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      length: 'short',
      tone: 'formal',
      focus: 'risks',
    })
  })

  it('sends a blank focus as null', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetch)
    await generateCustomSummary('d', DEFAULT_OPTIONS, signal())
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).focus).toBeNull()
  })

  it.each([{ document_id: 'other' }, { summary: ' ' }, { cached: 'yes' }])(
    'rejects an unexpected response %j',
    async (patch) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(patch)))
      await expect(
        generateCustomSummary('d', DEFAULT_OPTIONS, signal()),
      ).rejects.toThrow(/unexpected summary/)
    },
  )

  it.each([
    [404, /could not be found/],
    [409, /not ready/],
    [413, /too long/],
    [422, /not accepted/],
    [429, /Too many AI requests/],
    [500, /couldn’t write/],
  ])('explains status %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    )
    const error = await generateCustomSummary(
      'd',
      DEFAULT_OPTIONS,
      signal(),
    ).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toMatch(message)
  })
})
