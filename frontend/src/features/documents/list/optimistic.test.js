import { describe, expect, it } from 'vitest'
import {
  NO_OVERLAY,
  applyOverlay,
  effectiveStatus,
  pendingUpload,
  withAddedDocument,
  withReplacedDocument,
  withoutDocument,
} from './optimistic'

const doc = (id, status = 'embedded') => ({
  id,
  filename: `${id}.pdf`,
  content_type: 'application/pdf',
  size_bytes: 10,
  status,
  created_at: '2026-11-04T06:00:00Z',
})

const page = (
  items,
  { total = items.length, offset = 0, limit = 10 } = {},
) => ({
  items,
  total,
  offset,
  limit,
})

const overlay = (changes) => ({ ...NO_OVERLAY, ...changes })
const upload = pendingUpload({ name: 'New.pdf', size: 2048, type: '' })

describe('applyOverlay', () => {
  it('returns the very same page when nothing is in flight', () => {
    const loaded = page([doc('a')])
    expect(applyOverlay(loaded, NO_OVERLAY, false)).toBe(loaded)
  })

  it('hides documents being deleted and lowers the total', () => {
    const shown = applyOverlay(
      page([doc('a'), doc('b')], { total: 12 }),
      overlay({ hidden: new Set(['a']) }),
      false,
    )
    expect(shown.items.map((item) => item.id)).toEqual(['b'])
    expect(shown.total).toBe(11)
  })

  it('leaves the total alone for a hidden document that is on another page', () => {
    const loaded = page([doc('a')], { total: 12 })
    const shown = applyOverlay(
      loaded,
      overlay({ hidden: new Set(['elsewhere']) }),
      false,
    )
    expect(shown).toBe(loaded)
  })

  it('shows the guessed status until the server reports something else', () => {
    const guess = new Map([['a', { from: 'failed', to: 'queued' }]])
    const shown = applyOverlay(
      page([doc('a', 'failed'), doc('b', 'failed')]),
      overlay({ statuses: guess }),
      false,
    )
    expect(shown.items.map((item) => item.status)).toEqual(['queued', 'failed'])
    // The server moved on: the guess no longer applies.
    expect(effectiveStatus(doc('a', 'processing'), guess)).toBe('processing')
    expect(effectiveStatus(doc('a', 'failed'), guess)).toBe('queued')
  })

  it('shows a title ahead of the server, and null brings the file name back', () => {
    const titles = new Map([
      ['a', 'Q3 Plan'],
      ['b', null],
    ])
    const shown = applyOverlay(
      page([
        { ...doc('a'), title: 'Old' },
        { ...doc('b'), title: 'AI' },
        doc('c'),
      ]),
      overlay({ titles }),
      false,
    )
    expect(shown.items.map((item) => item.title)).toEqual([
      'Q3 Plan',
      null,
      undefined,
    ])
    expect(shown.total).toBe(3)
  })

  it('puts an upload in flight first, on the first unfiltered page only', () => {
    const withUpload = overlay({ uploading: upload })
    const first = applyOverlay(page([doc('a')]), withUpload, false)
    expect(first.items.map((item) => item.id)).toEqual(['pending-upload', 'a'])
    expect(first.items[0]).toMatchObject({
      filename: 'New.pdf',
      status: 'uploading',
      pending: true,
      content_type: 'application/pdf',
    })
    expect(first.total).toBe(2)

    const later = page([doc('a')], { total: 15, offset: 10 })
    expect(applyOverlay(later, withUpload, false)).toBe(later)
    const loaded = page([doc('a')])
    expect(applyOverlay(loaded, withUpload, true)).toBe(loaded)
  })
})

describe('confirmed changes', () => {
  it('removes a deleted document and lowers the total', () => {
    const result = withoutDocument(
      page([doc('a'), doc('b')], { total: 5 }),
      'a',
    )
    expect(result.items.map((item) => item.id)).toEqual(['b'])
    expect(result.total).toBe(4)
  })

  it('leaves the page untouched when the deleted document is not on it', () => {
    const loaded = page([doc('a')])
    expect(withoutDocument(loaded, 'zzz')).toBe(loaded)
  })

  it('adds an uploaded document first, keeping the page within its limit', () => {
    const full = page([doc('a'), doc('b')], { limit: 2, total: 2 })
    const result = withAddedDocument(full, doc('new', 'queued'))
    expect(result.items.map((item) => item.id)).toEqual(['new', 'a'])
    expect(result.total).toBe(3)
  })

  it('does not add a document to a later page, or twice', () => {
    const later = page([doc('a')], { offset: 10, total: 11 })
    expect(withAddedDocument(later, doc('new'))).toBe(later)
    const first = page([doc('new')])
    expect(withAddedDocument(first, doc('new'))).toBe(first)
  })

  it('replaces a document with the server’s version of it', () => {
    const result = withReplacedDocument(
      page([{ ...doc('a', 'failed'), category: 'Legal' }, doc('b')]),
      doc('a', 'queued'),
    )
    expect(result.items[0]).toMatchObject({
      status: 'queued',
      category: 'Legal',
    })
    const loaded = page([doc('b')])
    expect(withReplacedDocument(loaded, doc('a'))).toBe(loaded)
  })
})
