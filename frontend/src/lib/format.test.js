import { describe, expect, it } from 'vitest'
import { displayTitle, documentTitle } from './format'

describe('documentTitle', () => {
  it.each([
    [
      'AI-Powered Vault Document System_  Case Study.pdf',
      'AI-Powered Vault Document System: Case Study',
    ],
    ['quarterly_report_final.PDF', 'quarterly report final'],
    ['Notes.pdf', 'Notes'],
    ['Scan_2026.PNG', 'Scan 2026'],
    ['photo.jpeg', 'photo'],
    ['receipt.jpg', 'receipt'],
    ['already a nice title', 'already a nice title'],
    ['Budget_ 2026_.pdf', 'Budget: 2026'],
    ['  spaced   out .pdf', 'spaced out'],
  ])('turns %j into %j', (filename, title) => {
    expect(documentTitle(filename)).toBe(title)
  })

  it('never returns an empty title', () => {
    expect(documentTitle('.pdf')).toBe('.pdf')
    expect(documentTitle('___.pdf')).toBe('___.pdf')
  })
})

describe('displayTitle', () => {
  it('prefers a title and otherwise tidies the file name', () => {
    expect(displayTitle({ title: 'Q3 Plan', filename: 'x_y.pdf' })).toBe(
      'Q3 Plan',
    )
    expect(displayTitle({ title: null, filename: 'x_y.pdf' })).toBe('x y')
    expect(displayTitle({ filename: 'Notes.pdf' })).toBe('Notes')
    expect(displayTitle({ title: '', filename: 'Notes.pdf' })).toBe('Notes')
  })
})
