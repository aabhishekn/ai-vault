import { describe, expect, it } from 'vitest'
import { focusPassage, splitPassage, terms } from './passage'

const long = [
  'The office opens at nine each weekday morning.',
  'Visitors must sign in at the front desk first.',
  'Parking permits cost forty dollars every month.',
  'Refunds are paid within thirty days of a written request.',
  'The kitchen is cleaned every Friday afternoon.',
  'Fire drills happen twice a year without warning.',
].join(' ')

describe('splitPassage', () => {
  it.each([
    ['one two three four. five six seven eight. nine'],
    [
      '  leading space and a\nline break here for the test\nand more words follow',
    ],
    ['Intro words here now • first point is this • second point is that'],
    [''],
    ['   '],
    ['word'],
  ])('joins back into exactly the original text: %j', (text) => {
    expect(splitPassage(text).join('')).toBe(text)
  })

  it('ends a unit at a sentence end', () => {
    expect(
      splitPassage('Alpha beta gamma delta. Epsilon zeta eta theta.'),
    ).toEqual(['Alpha beta gamma delta. ', 'Epsilon zeta eta theta.'])
  })

  it('lets a very short sentence join the next one', () => {
    expect(splitPassage('Is it ok? Yes it is fine for now.')).toEqual([
      'Is it ok? Yes it is fine for now.',
    ])
  })

  it('starts a new unit at a bullet', () => {
    expect(
      splitPassage('Duties include • filing reports • answering mail'),
    ).toEqual(['Duties include ', '• filing reports ', '• answering mail'])
  })

  it('cuts a long run with no sentence end', () => {
    const words = Array.from({ length: 50 }, (_, index) => `w${index}`)
    const units = splitPassage(words.join(' '))
    expect(units).toHaveLength(3)
    expect(units[0].trim().split(' ')).toHaveLength(24)
  })
})

describe('terms', () => {
  it('matches word forms and drops filler words', () => {
    expect(terms('The tickets were released')).toEqual(
      terms('a ticket releases'),
    )
    expect(terms('processing')).toEqual(terms('process'))
    expect(terms('the and of to')).toEqual(new Set())
  })
})

describe('focusPassage', () => {
  it('finds the sentence that backs the answer and leaves out the rest', () => {
    const view = focusPassage(long, 'Refunds are paid within thirty days.')
    expect(view.trimmed).toBe(true)
    const marked = view.excerpt.filter((piece) => piece.hit)
    expect(marked.map((piece) => piece.text.trim())).toEqual([
      'Refunds are paid within thirty days of a written request.',
    ])
    expect(view.excerpt.some((piece) => piece.gap)).toBe(true)
    expect(
      view.excerpt.map((piece) => piece.text ?? '').join(''),
    ).not.toContain('Fire drills')
  })

  it('keeps the whole passage, marked, for the full view', () => {
    const view = focusPassage(long, 'Refunds are paid within thirty days.')
    expect(view.full.map((piece) => piece.text).join('')).toBe(long)
    expect(view.full.filter((piece) => piece.hit)).toHaveLength(1)
  })

  it('weighs a rare word above a common one', () => {
    const text =
      'Staff meet monthly to plan the work ahead. Staff meet weekly to plan the shifts. ' +
      'Budget approval needs the director signature first. Staff meet daily to plan the day. ' +
      'Staff meet yearly to plan the budget cycle. Staff meet rarely to plan the trips.'
    const view = focusPassage(
      text,
      'Who must sign for budget approval? Staff meet.',
    )
    expect(view.excerpt.find((piece) => piece.hit).text).toContain(
      'Budget approval',
    )
  })

  it('shows a short passage whole, still marking the match', () => {
    const view = focusPassage(
      'Refunds are paid within thirty days. Parking costs forty dollars. Visitors sign in.',
      'Refunds are paid within thirty days.',
    )
    expect(view.trimmed).toBe(false)
    expect(view.excerpt).toBe(view.full)
    expect(view.full.filter((piece) => piece.hit)).toHaveLength(1)
  })

  it('shows nothing marked when everything matches', () => {
    const view = focusPassage(
      'Refunds are paid fast. Refunds are paid now.',
      'Refunds are paid',
    )
    expect(view.full.some((piece) => piece.hit)).toBe(false)
  })

  it('returns null when nothing in the passage matches or there is one unit', () => {
    expect(focusPassage(long, 'Quantum chromodynamics lattice')).toBeNull()
    expect(focusPassage('Single sentence here.', 'single sentence')).toBeNull()
  })
})
