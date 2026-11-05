// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Working } from './Working'

afterEach(cleanup)

describe('Working', () => {
  it('announces what is happening once, with a default reminder to stay', () => {
    render(createElement(Working, { title: 'Searching your documents…' }))
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Searching your documents…')
    expect(status.textContent).toContain('Keep this view open')
  })
  it('takes its own hint and hides the decorative dots from assistive tech', () => {
    const { container } = render(
      createElement(Working, { title: 'Writing…', hint: 'A moment.' }),
    )
    expect(screen.getByText('A moment.')).toBeTruthy()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })
})
