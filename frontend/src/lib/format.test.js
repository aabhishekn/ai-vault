import { describe, expect, it } from 'vitest'
import { displayTitle, documentTitle, readableText } from './format'

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

describe('readableText', () => {
  it('turns symbol-font bullets into real ones and leaves other text alone', () => {
    expect(readableText('Resume or CV \uF0B7 Duration \u00B7 45 minutes')).toBe(
      'Resume or CV • Duration \u00B7 45 minutes',
    )
    expect(readableText('Plain text.')).toBe('Plain text.')
  })
})
