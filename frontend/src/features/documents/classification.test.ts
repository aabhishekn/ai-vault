// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { listDocuments, isDocument } from './api'
import { classifyDocument, getTagsOverview } from './classification'
import { DocumentFilters } from './DocumentFilters'
import { DocumentTags } from './DocumentTags'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const signal = () => new AbortController().signal

describe('classification API', () => {
  it('posts and returns the category and tags', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ document_id: 'd', category: 'Legal', tags: ['lease'] }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(classifyDocument('d', signal())).resolves.toEqual({
      category: 'Legal',
      tags: ['lease'],
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/documents/d/classification')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })

  it.each([
    [409, /not ready/],
    [429, /Too many AI/],
    [500, /couldn’t add tags/],
  ])('explains status %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    )
    const error = await classifyDocument('d', signal()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toMatch(message)
  })

  it('rejects a response for another document or with bad tags', async () => {
    for (const body of [
      { document_id: 'x', category: 'Legal', tags: [] },
      { document_id: 'd', category: 'Legal', tags: [1] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
      await expect(classifyDocument('d', signal())).rejects.toThrow(
        /unexpected tags/,
      )
    }
  })

  it('reads the tag overview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          categories: [{ category: 'Legal', count: 2 }],
          tags: [{ tag: 'lease', count: 1 }],
        }),
      ),
    )
    await expect(getTagsOverview(signal())).resolves.toEqual({
      categories: [{ category: 'Legal', count: 2 }],
      tags: [{ tag: 'lease', count: 1 }],
    })
  })
})

describe('document list filters and tolerance', () => {
  const doc = {
    id: 'a',
    filename: 'a.pdf',
    content_type: 'application/pdf',
    size_bytes: 5,
    status: 'embedded',
    created_at: '2026-11-04T00:00:00Z',
  }

  it('sends category and tag as query parameters', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ items: [], total: 0, limit: 10, offset: 0 }),
      )
    vi.stubGlobal('fetch', fetch)
    await listDocuments({
      limit: 10,
      offset: 0,
      signal: signal(),
      filter: { category: 'Legal', tag: 'lease' },
    })
    const url = new URL(String(fetch.mock.calls[0]?.[0]), 'http://x')
    expect(url.searchParams.get('category')).toBe('Legal')
    expect(url.searchParams.get('tag')).toBe('lease')
  })

  it('accepts documents with or without tags but rejects malformed ones', () => {
    expect(isDocument(doc)).toBe(true)
    expect(isDocument({ ...doc, category: 'Legal', tags: ['x'] })).toBe(true)
    expect(isDocument({ ...doc, tags: 'x' })).toBe(false)
    expect(isDocument({ ...doc, category: 5 })).toBe(false)
  })
})

describe('tag components', () => {
  it('lets a filter change reset to the chosen value', () => {
    const onChange = vi.fn()
    render(
      createElement(DocumentFilters, {
        overview: {
          categories: [{ category: 'Legal', count: 2 }],
          tags: [{ tag: 'lease', count: 1 }],
        },
        filter: {},
        onChange,
      }),
    )
    fireEvent.change(screen.getByLabelText('Tag'), {
      target: { value: 'lease' },
    })
    expect(onChange).toHaveBeenCalledWith({ tag: 'lease' })
  })

  it('shows saved tags, or offers to add them once and shows the result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          document_id: 'd',
          category: 'Finance',
          tags: ['budget'],
        }),
      )
    vi.stubGlobal('fetch', fetch)
    render(createElement(DocumentTags, { id: 'd', status: 'embedded' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Add category and tags' }),
    )
    expect(await screen.findByText('Finance')).toBeTruthy()
    expect(screen.getByText('budget')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('offers nothing while the document is still processing', () => {
    render(createElement(DocumentTags, { id: 'd', status: 'queued' }))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
