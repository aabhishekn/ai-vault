// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api'
import { listDocuments, isDocument } from '../api'
import { classifyDocument } from './classification'
import { DocumentCategory } from './DocumentCategory'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const signal = () => new AbortController().signal

describe('classification API', () => {
  it('posts and returns the category', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ document_id: 'd', category: 'Resume', title: 'T' }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(classifyDocument('d', signal())).resolves.toEqual({
      category: 'Resume',
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/documents/d/classification')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })

  it.each([
    [409, /not ready/],
    [429, /Too many AI/],
    [500, /couldn’t add a category/],
  ])('explains status %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    )
    const error = await classifyDocument('d', signal()).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toMatch(message)
  })

  it('rejects a response for another document or without a category', async () => {
    for (const body of [
      { document_id: 'x', category: 'Legal' },
      { document_id: 'd', category: 5 },
      { document_id: 'd' },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
      await expect(classifyDocument('d', signal())).rejects.toThrow(
        /unexpected category/,
      )
    }
  })
})

describe('document list search and tolerance', () => {
  const doc = {
    id: 'a',
    filename: 'a.pdf',
    content_type: 'application/pdf',
    size_bytes: 5,
    status: 'embedded',
    created_at: '2026-11-04T00:00:00Z',
  }
  // A fresh response per call: a body can only be read once.
  const empty = () =>
    vi.fn(() =>
      Promise.resolve(
        Response.json({ items: [], total: 0, limit: 10, offset: 0 }),
      ),
    )

  it('sends the search words as q, and nothing when there are none', async () => {
    const fetch = empty()
    vi.stubGlobal('fetch', fetch)
    await listDocuments({
      limit: 10,
      offset: 0,
      signal: signal(),
      search: 'lease terms',
    })
    await listDocuments({ limit: 10, offset: 0, signal: signal(), search: '' })
    const first = new URL(String(fetch.mock.calls[0]?.[0]), 'http://x')
    const second = new URL(String(fetch.mock.calls[1]?.[0]), 'http://x')
    expect(first.searchParams.get('q')).toBe('lease terms')
    expect(second.searchParams.has('q')).toBe(false)
    expect(first.searchParams.has('tag')).toBe(false)
  })

  it('accepts documents with or without a category but rejects malformed ones', () => {
    expect(isDocument(doc)).toBe(true)
    expect(isDocument({ ...doc, category: 'Resume' })).toBe(true)
    expect(isDocument({ ...doc, category: null })).toBe(true)
    expect(isDocument({ ...doc, category: 5 })).toBe(false)
  })
})

describe('document category', () => {
  it('shows the category as a label', () => {
    render(
      createElement(DocumentCategory, {
        id: 'd',
        status: 'embedded',
        category: 'Interview Guide',
      }),
    )
    expect(screen.getByText('Interview Guide')).toBeTruthy()
    expect(screen.getByText(/Category:/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers to add one once and shows the result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ document_id: 'd', category: 'Finance' }),
      )
    vi.stubGlobal('fetch', fetch)
    render(createElement(DocumentCategory, { id: 'd', status: 'embedded' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('Finance')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('says why adding one failed and allows another try', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 429 })),
    )
    render(createElement(DocumentCategory, { id: 'd', status: 'ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Too many AI/,
    )
    expect(screen.getByRole('button', { name: 'Add category' })).toBeTruthy()
  })

  it('offers nothing while the document is still processing', () => {
    render(createElement(DocumentCategory, { id: 'd', status: 'queued' }))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
