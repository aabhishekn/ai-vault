import { describe, expect, it } from 'vitest'
import { groupSources, parseAnswer, splitCitations } from './answerText'

describe('parseAnswer', () => {
  it('keeps a plain answer as one paragraph', () => {
    expect(parseAnswer('Python is required [1].')).toEqual([
      { type: 'paragraph', text: 'Python is required [1].' },
    ])
  })
  it('turns lines that start with a dash into a list after the lead sentence', () => {
    expect(
      parseAnswer(
        'Three things are due.\n- Form A [1]\n- Form B [2]\n* Form C',
      ),
    ).toEqual([
      { type: 'paragraph', text: 'Three things are due.' },
      { type: 'bullets', items: ['Form A [1]', 'Form B [2]', 'Form C'] },
    ])
  })
  it('reads numbered lines as an ordered list and keeps text after the list', () => {
    expect(parseAnswer('1. Apply\n2) Interview\nThat is all.')).toEqual([
      { type: 'numbers', items: ['Apply', 'Interview'] },
      { type: 'paragraph', text: 'That is all.' },
    ])
  })
  it('splits blocks on blank lines and drops empty ones', () => {
    expect(parseAnswer('One.\n\n\n\nTwo.\n\n')).toEqual([
      { type: 'paragraph', text: 'One.' },
      { type: 'paragraph', text: 'Two.' },
    ])
  })
  it('does not mistake a dash inside a sentence for a list', () => {
    expect(parseAnswer('A - B is fine.')).toEqual([
      { type: 'paragraph', text: 'A - B is fine.' },
    ])
  })
})

describe('splitCitations', () => {
  const known = new Set([1, 2, 3])
  it('joins labels that sit together into one capsule, however they are separated', () => {
    expect(splitCitations('Fees [1][2], [3] apply.', known)).toEqual([
      { type: 'text', value: 'Fees ' },
      { type: 'cite', numbers: [1, 2, 3] },
      { type: 'text', value: ' apply.' },
    ])
  })
  it('keeps separate capsules apart and leaves labels with no source as text', () => {
    expect(splitCitations('A [1] then B [9] and C [2].', known)).toEqual([
      { type: 'text', value: 'A ' },
      { type: 'cite', numbers: [1] },
      { type: 'text', value: ' then B [9] and C ' },
      { type: 'cite', numbers: [2] },
      { type: 'text', value: '.' },
    ])
  })
  it('does not repeat a label that is written twice in a row', () => {
    expect(splitCitations('Yes [1][1].', known)).toEqual([
      { type: 'text', value: 'Yes ' },
      { type: 'cite', numbers: [1] },
      { type: 'text', value: '.' },
    ])
  })
  it('returns plain text untouched', () => {
    expect(splitCitations('Nothing cited.', known)).toEqual([
      { type: 'text', value: 'Nothing cited.' },
    ])
  })
})

describe('groupSources', () => {
  it('groups by document in order of first appearance', () => {
    const cite = (source_number, filename) => ({ source_number, filename })
    expect(
      groupSources([cite(1, 'a.pdf'), cite(2, 'b.pdf'), cite(3, 'a.pdf')]),
    ).toEqual([
      { filename: 'a.pdf', citations: [cite(1, 'a.pdf'), cite(3, 'a.pdf')] },
      { filename: 'b.pdf', citations: [cite(2, 'b.pdf')] },
    ])
  })
  it('puts sources with no file name in one group', () => {
    expect(groupSources([{ source_number: 1 }, { source_number: 2 }])).toEqual([
      { filename: '', citations: [{ source_number: 1 }, { source_number: 2 }] },
    ])
  })
})
