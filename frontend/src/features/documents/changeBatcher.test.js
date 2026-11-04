import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChangeBatcher } from './changeBatcher'

const change = (id, content = false) => ({
  ids: new Set([id]),
  content: new Set(content ? [id] : []),
})

afterEach(() => vi.useRealTimers())

describe('change batcher', () => {
  it('delivers one merged batch after a quiet moment', () => {
    vi.useFakeTimers()
    const deliver = vi.fn()
    const batcher = createChangeBatcher(deliver, 300)
    batcher.add(change('a'))
    vi.advanceTimersByTime(200)
    batcher.add(change('b', true))
    vi.advanceTimersByTime(299)
    expect(deliver).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(deliver).toHaveBeenCalledExactlyOnceWith({
      ids: new Set(['a', 'b']),
      content: new Set(['b']),
    })
  })
  it('lets "anything may have changed" absorb the rest', () => {
    vi.useFakeTimers()
    const deliver = vi.fn()
    const batcher = createChangeBatcher(deliver, 100)
    batcher.add(change('a'))
    batcher.add(null)
    batcher.add(change('b'))
    vi.advanceTimersByTime(100)
    expect(deliver).toHaveBeenCalledExactlyOnceWith(null)
  })
  it('delivers nothing once cancelled', () => {
    vi.useFakeTimers()
    const deliver = vi.fn()
    const batcher = createChangeBatcher(deliver, 100)
    batcher.add(change('a'))
    batcher.cancel()
    vi.advanceTimersByTime(1000)
    expect(deliver).not.toHaveBeenCalled()
  })
})
