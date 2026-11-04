// @vitest-environment jsdom
import { createElement } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomSummary } from './CustomSummary'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('custom summary form', () => {
  it('sends the chosen options once and shows the result', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        document_id: 'd',
        summary: 'A brief executive summary.',
        cached: true,
      }),
    )
    vi.stubGlobal('fetch', fetch)
    render(createElement(CustomSummary, { id: 'd' }))
    fireEvent.change(screen.getByLabelText('Length'), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByLabelText('Tone'), {
      target: { value: 'executive' },
    })
    fireEvent.change(screen.getByLabelText('Focus (optional)'), {
      target: { value: 'risks' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate custom summary' }),
    )
    expect(await screen.findByText('A brief executive summary.')).toBeTruthy()
    expect(screen.getByText(/reused from earlier/)).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      length: 'short',
      tone: 'executive',
      focus: 'risks',
    })
  })

  it('shows a readable error and lets you try again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        Response.json({
          document_id: 'd',
          summary: 'Second try.',
          cached: false,
        }),
      )
    vi.stubGlobal('fetch', fetch)
    render(createElement(CustomSummary, { id: 'd' }))
    const button = () =>
      screen.getByRole('button', { name: 'Generate custom summary' })
    fireEvent.click(button())
    expect((await screen.findByRole('alert')).textContent).toMatch(/not ready/)
    fireEvent.click(button())
    await waitFor(() => expect(screen.getByText('Second try.')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
