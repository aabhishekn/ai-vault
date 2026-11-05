// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReadyDocuments } from './useReadyDocuments'

afterEach(() => vi.unstubAllGlobals())

const item = (id, status = 'embedded') => ({
  id,
  filename: `${id}.pdf`,
  content_type: 'application/pdf',
  size_bytes: 10,
  status,
  created_at: '2026-11-04T06:00:00Z',
})
const success = (items, total = items.length) => ({
  status: 'success',
  page: { items, total, limit: 10, offset: 0 },
})

describe('useReadyDocuments', () => {
  it('uses the visible page when it holds every document', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() =>
      useReadyDocuments(success([item('a'), item('b', 'queued'), item('c')])),
    )
    expect(result.current.ready.map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(result.current).toMatchObject({
      loaded: true,
      total: 3,
      waiting: 1,
      anyReady: true,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports nothing before the list has loaded', () => {
    const { result } = renderHook(() =>
      useReadyDocuments({ status: 'loading' }),
    )
    expect(result.current).toMatchObject({ ready: [], loaded: false, total: 0 })
  })

  it('reads further pages when the list holds more than one', async () => {
    const all = Array.from({ length: 12 }, (_, index) => item(`d${index}`))
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({ items: all, total: 12, limit: 100, offset: 0 }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const visible = success(all.slice(0, 10), 12)
    const { result } = renderHook(() => useReadyDocuments(visible))
    expect(result.current.ready).toHaveLength(10)
    await waitFor(() => expect(result.current.ready).toHaveLength(12))
    expect(String(fetch.mock.calls[0][0])).toContain('limit=100')
  })

  it('keeps the visible page when reading further pages fails', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('x', { status: 500 })),
    )
    vi.stubGlobal('fetch', fetch)
    const visible = success([item('a'), item('b')], 30)
    const { result } = renderHook(() => useReadyDocuments(visible))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(result.current.ready.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  describe('while the list is being searched', () => {
    const library = [item('a'), item('b'), item('c', 'queued')]
    const serveLibrary = () => {
      const fetch = vi.fn(() =>
        Promise.resolve(
          Response.json({ items: library, total: 3, limit: 100, offset: 0 }),
        ),
      )
      vi.stubGlobal('fetch', fetch)
      return fetch
    }
    const ids = (result) => result.current.ready.map((entry) => entry.id)

    it('keeps the whole library, not just the matches', async () => {
      const fetch = serveLibrary()
      const everything = success(library)
      const matches = success([item('a')], 1)
      const { result, rerender } = renderHook(
        ({ state, searching }) => useReadyDocuments(state, searching),
        { initialProps: { state: everything, searching: false } },
      )
      expect(fetch).not.toHaveBeenCalled()
      rerender({ state: matches, searching: true })
      // Straight away: what the chat could ask about before the search began.
      expect(ids(result)).toEqual(['a', 'b'])
      expect(result.current.total).toBe(3)
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(String(fetch.mock.calls[0][0])).toContain('limit=100')
      expect(String(fetch.mock.calls[0][0])).not.toContain('q=')
      expect(ids(result)).toEqual(['a', 'b'])
      expect(result.current).toMatchObject({ total: 3, waiting: 1 })
    })

    it('does not say the vault is empty when a search finds nothing', async () => {
      serveLibrary()
      const { result, rerender } = renderHook(
        ({ state, searching }) => useReadyDocuments(state, searching),
        { initialProps: { state: success(library), searching: false } },
      )
      rerender({ state: success([], 0), searching: true })
      expect(result.current).toMatchObject({ total: 3, anyReady: true })
      await waitFor(() => expect(ids(result)).toEqual(['a', 'b']))
      expect(result.current.total).toBe(3)
    })

    it('follows the visible list again once the search is cleared', async () => {
      serveLibrary()
      const { result, rerender } = renderHook(
        ({ state, searching }) => useReadyDocuments(state, searching),
        { initialProps: { state: success(library), searching: false } },
      )
      rerender({ state: success([item('a')], 1), searching: true })
      await waitFor(() => expect(ids(result)).toEqual(['a', 'b']))
      rerender({ state: success([item('a'), item('d')], 2), searching: false })
      expect(ids(result)).toEqual(['a', 'd'])
      expect(result.current.total).toBe(2)
    })
  })
})
