import { describe, expect, it } from 'vitest'
import { chatScope, MAX_SCOPE, readyEntries } from './scope'

const ready = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `d${index}`,
    name: `Doc ${index}`,
  }))

describe('chatScope', () => {
  it('asks only the ticked documents, even when others are ready', () => {
    const scope = chatScope(new Map([['d2', 'Doc 2']]), ready(5))
    expect(scope).toMatchObject({ kind: 'single', ids: ['d2'], key: 'd2' })
    expect(scope.implicit).toBeUndefined()
  })

  it('keeps one key for the same ticked documents in any order', () => {
    const one = chatScope(
      new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
      [],
    )
    const two = chatScope(
      new Map([
        ['b', 'B'],
        ['a', 'A'],
      ]),
      [],
    )
    expect(one.kind).toBe('picked')
    expect(one.key).toBe(two.key)
  })

  it('has nothing to ask while no document is ready', () => {
    expect(chatScope(new Map(), [])).toMatchObject({ kind: 'none', ids: [] })
  })

  it('asks the only ready document as a conversation of its own', () => {
    expect(chatScope(new Map(), ready(1))).toMatchObject({
      kind: 'single',
      ids: ['d0'],
      key: 'd0',
      implicit: true,
    })
  })

  it('asks all ready documents under a key that survives new ones arriving', () => {
    const before = chatScope(new Map(), ready(2))
    const after = chatScope(new Map(), ready(3))
    expect(before).toMatchObject({ kind: 'all', implicit: true })
    expect(after.ids).toHaveLength(3)
    expect(after.key).toBe(before.key)
  })

  it('stops at the newest ten and says so', () => {
    const scope = chatScope(new Map(), ready(MAX_SCOPE + 2))
    expect(scope.ids).toHaveLength(MAX_SCOPE)
    expect(scope).toMatchObject({ truncated: true, total: MAX_SCOPE + 2 })
  })
})

describe('readyEntries', () => {
  it('keeps documents that can be asked about, under their readable titles', () => {
    const entries = readyEntries([
      { id: '1', filename: 'a.pdf', status: 'embedded', title: 'Lease' },
      { id: '2', filename: 'b.pdf', status: 'queued' },
      { id: '3', filename: 'My_Report.pdf', status: 'ready' },
    ])
    expect(entries).toEqual([
      { id: '1', name: 'Lease' },
      { id: '3', name: 'My Report' },
    ])
  })
})
