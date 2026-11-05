// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnswerResult } from './AnswerResult'

afterEach(cleanup)

const source = (number, filename, page) => ({
  source_number: number,
  filename,
  page_number: page,
  chunk_id: `chunk-${number}`,
  text: `Passage ${number}.`,
})

function show(answer, citations) {
  return render(
    createElement(AnswerResult, {
      result: {
        question: 'What is due?',
        answer,
        insufficient_evidence: false,
        citations,
      },
    }),
  )
}

describe('answer layout', () => {
  it('shows several points as a list, each with its own labels', () => {
    show('Two things are due.\n- Form A [1]\n- Form B [2][3]', [
      source(1, 'a.pdf', 1),
      source(2, 'a.pdf', 2),
      source(3, 'b.pdf', 3),
    ])
    const items = screen.getAllByRole('listitem', { name: '' })
    const points = items.filter((item) => item.closest('ul'))
    expect(points.map((item) => item.textContent)).toEqual([
      'Form A [1]',
      'Form B [2][3]',
    ])
    expect(screen.getByText('Two things are due.').tagName).toBe('P')
  })

  it('opens the source each label in a group names, one at a time', () => {
    show('Both apply [1][2].', [source(1, 'a.pdf', 1), source(2, 'a.pdf', 2)])
    fireEvent.click(screen.getByRole('button', { name: 'Show source 2' }))
    expect(screen.getByText('Passage 2.')).toBeTruthy()
    expect(screen.queryByText('Passage 1.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show source 1' }))
    expect(screen.getByText('Passage 1.')).toBeTruthy()
  })

  it('leaves a label that names no source as plain text', () => {
    show('See page [7] and the form [1].', [source(1, 'a.pdf', 1)])
    expect(screen.queryByRole('button', { name: 'Show source 7' })).toBeNull()
    expect(screen.getByText(/See page/).textContent).toBe(
      'See page [7] and the form [1].',
    )
  })

  it('groups sources under the document they came from', () => {
    show('A [1] and B [2] and A again [3].', [
      source(1, 'lease.pdf', 4),
      source(2, 'budget.pdf', 1),
      source(3, 'lease.pdf', 5),
    ])
    expect(screen.getAllByText('lease')).toHaveLength(1)
    expect(screen.getAllByText('budget')).toHaveLength(1)
    const lease = screen.getByText('lease').parentElement
    expect(
      [...lease.querySelectorAll('button')].map((chip) => chip.textContent),
    ).toEqual(['[1] · Page 4', '[3] · Page 5'])
  })
})
