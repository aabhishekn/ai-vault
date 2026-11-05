import { describe, expect, it } from 'vitest'
import {
  groupSources,
  parseAnswer,
  sentencesCiting,
  sourceName,
  splitCitations,
} from './answerText'

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
  const cite = (source_number, filename, document_id) => ({
    source_number,
    filename,
    document_id,
  })
  it('groups by document in order of first appearance', () => {
    const sources = [
      cite(1, 'a.pdf', 'da'),
      cite(2, 'b.pdf', 'db'),
      cite(3, 'a.pdf', 'da'),
    ]
    expect(groupSources(sources)).toEqual([
      { key: 'da', citation: sources[0], citations: [sources[0], sources[2]] },
      { key: 'db', citation: sources[1], citations: [sources[1]] },
    ])
  })
  it('tells documents apart by ID, even when two share a file name', () => {
    const groups = groupSources([
      cite(1, 'x.pdf', 'd1'),
      cite(2, 'x.pdf', 'd2'),
    ])
    expect(groups.map((group) => group.key)).toEqual(['d1', 'd2'])
  })
  it('falls back to the file name, and puts sources with neither in one group', () => {
    expect(groupSources([cite(1, 'a.pdf'), cite(2, 'a.pdf')])).toHaveLength(1)
    expect(groupSources([cite(1), cite(2)])).toHaveLength(1)
  })
})

describe('sourceName', () => {
  const tidy = (name) => name.replace('.pdf', '')
  it('prefers the title, then a tidied file name, then nothing', () => {
    expect(sourceName({ title: 'Lease', filename: 'IMG_1.jpg' }, tidy)).toBe(
      'Lease',
    )
    expect(sourceName({ title: null, filename: 'a.pdf' }, tidy)).toBe('a')
    expect(sourceName({ title: '', filename: 'a.pdf' }, tidy)).toBe('a')
    expect(sourceName({}, tidy)).toBe('')
  })
})

describe('sentencesCiting', () => {
  it('returns the sentences that cite a source, without their labels', () => {
    const answer =
      'Fees apply [1]. Rent is due monthly [2]. Late fees are extra [1].'
    expect(sentencesCiting(answer, 1)).toBe('Fees apply. Late fees are extra.')
    expect(sentencesCiting(answer, 2)).toBe('Rent is due monthly.')
  })
  it('keeps a label written after the full stop with its sentence', () => {
    expect(sentencesCiting('Fees apply. [1] Rent is due. [2]', 1)).toBe(
      'Fees apply.',
    )
    expect(sentencesCiting('Fees apply. [1] Rent is due. [2]', 2)).toBe(
      'Rent is due.',
    )
  })
  it('counts unlabelled sentences for the labelled one that follows them', () => {
    const answer =
      'Visitors sign in. They get a badge. Parking is paid [1]. Doors lock at ten [2].'
    expect(sentencesCiting(answer, 1)).toBe(
      'Visitors sign in. They get a badge. Parking is paid.',
    )
    expect(sentencesCiting(answer, 2)).toBe('Doors lock at ten.')
  })
  it('reads list lines as their own sentences', () => {
    expect(sentencesCiting('Due:\n- Form A [1]\n- Form B [2]', 2)).toBe(
      'Form B',
    )
  })
  it('returns an empty string for a source the answer never cites', () => {
    expect(sentencesCiting('Fees apply [1].', 3)).toBe('')
  })
})
