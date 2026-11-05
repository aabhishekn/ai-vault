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

  it('names a source by its document title, not the file name', () => {
    const named = (number, title) => ({
      ...source(number, 'IMG 2886.jpg', 1),
      document_id: 'd1',
      title,
    })
    show('The flow ends in a ticket [1].', [named(1, 'Email Workflow')])
    expect(screen.getByText('Email Workflow')).toBeTruthy()
    expect(screen.queryByText('IMG 2886')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^\[1\] · Page 1$/ }))
    expect(screen.getByText('[1] · Email Workflow · Page 1')).toBeTruthy()
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

  describe('the passage behind a source', () => {
    const passage = [
      'The office opens at nine each weekday morning.',
      'Visitors must sign in at the front desk first.',
      'Parking permits cost forty dollars every month.',
      'Refunds are paid within thirty days of a written request.',
      'The kitchen is cleaned every Friday afternoon.',
      'Fire drills happen twice a year without warning.',
    ].join(' ')

    function open(answer = 'Refunds are paid within thirty days [1].') {
      show(answer, [{ ...source(1, 'a.pdf', 1), text: passage }])
      fireEvent.click(screen.getByRole('button', { name: /^\[1\] · Page 1$/ }))
    }

    it('shows the part that backs the answer, marked, and hides the rest', () => {
      open()
      const quote = document.querySelector('blockquote')
      expect(quote.querySelector('mark').textContent).toContain(
        'Refunds are paid within thirty days',
      )
      expect(quote.textContent).not.toContain('Fire drills')
      expect(quote.textContent).not.toContain('The office opens')
      expect(quote.textContent).toContain('Showing the part that matches')
    })

    it('shows the whole passage on request and goes back', () => {
      open()
      const toggle = screen.getByRole('button', { name: 'Show full passage' })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(toggle)
      const quote = document.querySelector('blockquote')
      expect(quote.textContent).toContain('Fire drills')
      expect(quote.textContent).toContain('The office opens')
      expect(quote.querySelectorAll('mark')).toHaveLength(1)
      fireEvent.click(
        screen.getByRole('button', { name: 'Show only the match' }),
      )
      expect(document.querySelector('blockquote').textContent).not.toContain(
        'Fire drills',
      )
    })

    it('shows a short passage whole, with no toggle', () => {
      show('Python is required [1].', [source(1, 'a.pdf', 1)])
      fireEvent.click(screen.getByRole('button', { name: /^\[1\] · Page 1$/ }))
      expect(
        screen.queryByRole('button', { name: 'Show full passage' }),
      ).toBeNull()
      expect(screen.getByText('Passage 1.')).toBeTruthy()
    })
  })
})
