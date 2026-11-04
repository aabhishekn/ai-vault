import { describe, expect, it } from 'vitest'
import { documentTitle } from './format'

describe('documentTitle', () => {
  it.each([
    [
      'AI-Powered Vault Document System_  Case Study.pdf',
      'AI-Powered Vault Document System: Case Study',
    ],
    ['quarterly_report_final.PDF', 'quarterly report final'],
    ['Notes.pdf', 'Notes'],
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
