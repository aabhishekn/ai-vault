// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api'
import { useGeneratedDocumentContent } from './useGeneratedDocumentContent'

afterEach(cleanup)

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createApi() {
  return {
    load: vi.fn().mockResolvedValue(null),
    generate: vi.fn().mockResolvedValue('Saved result'),
    loadError: 'Read failed',
    generationError: 'Check saved content before retrying',
  }
}

describe('generated document content lifecycle', () => {
  it('only reads on mount, including React StrictMode, and refresh', async () => {
    const api = createApi()
    const { result } = renderHook(
      () => useGeneratedDocumentContent('a', true, api),
      { reactStrictMode: true },
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    expect(api.generate).not.toHaveBeenCalled()
  })

  it('prevents duplicate generation and refresh while generation is pending', async () => {
    const api = createApi()
    const pending = deferred()
    api.generate.mockReturnValue(pending.promise)
    const { result } = renderHook(() =>
      useGeneratedDocumentContent('a', true, api),
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    let generation
    act(() => {
      generation = result.current.generate()
      void result.current.generate()
      result.current.refresh()
    })
    expect(result.current.state.status).toBe('generating')
    expect(api.generate).toHaveBeenCalledTimes(1)
    expect(api.load).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve('Cited insights')
      await generation
    })
    expect(result.current.state).toEqual({
      status: 'success',
      data: 'Cited insights',
    })
    await act(async () => {
      await result.current.generate()
    })
    expect(api.generate).toHaveBeenCalledTimes(1)
  })

  it('requires checking saved content after an unconfirmed generation', async () => {
    const api = createApi()
    api.generate.mockRejectedValueOnce(new ApiError('Check for saved result'))
    const { result } = renderHook(() =>
      useGeneratedDocumentContent('a', true, api),
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    await act(async () => {
      await result.current.generate()
    })
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Check for saved result',
    })
    await act(async () => {
      await result.current.generate()
    })
    expect(api.generate).toHaveBeenCalledTimes(1)
    api.load.mockResolvedValueOnce('Saved by server after disconnect')
    act(() => result.current.refresh())
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'success',
        data: 'Saved by server after disconnect',
      }),
    )
    expect(api.generate).toHaveBeenCalledTimes(1)
  })

  it('blocks generation before usable text is available', async () => {
    const api = createApi()
    const { result } = renderHook(() =>
      useGeneratedDocumentContent('a', false, api),
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    await act(async () => {
      await result.current.generate()
    })
    expect(api.generate).not.toHaveBeenCalled()
  })

  it('aborts generation on unmount', async () => {
    const api = createApi()
    const pending = deferred()
    api.generate.mockReturnValue(pending.promise)
    const { result, unmount } = renderHook(() =>
      useGeneratedDocumentContent('a', true, api),
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    let generation
    act(() => {
      generation = result.current.generate()
    })
    const signal = api.generate.mock.calls[0][1]
    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve('Late result')
      await generation
    })
  })

  it('cancels an old generation and never shows its result for a new document', async () => {
    const api = createApi()
    const pending = deferred()
    api.generate.mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(
      ({ id }) => useGeneratedDocumentContent(id, true, api),
      { initialProps: { id: 'a' } },
    )
    await waitFor(() => expect(result.current.state.status).toBe('empty'))
    let generation
    act(() => {
      generation = result.current.generate()
    })
    const signal = api.generate.mock.calls[0][1]
    api.load.mockResolvedValueOnce('Document B content')
    rerender({ id: 'b' })
    expect(signal.aborted).toBe(true)
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'success',
        data: 'Document B content',
      }),
    )
    await act(async () => {
      pending.resolve('Document A late result')
      await generation
    })
    expect(result.current.state).toEqual({
      status: 'success',
      data: 'Document B content',
    })
  })
})
