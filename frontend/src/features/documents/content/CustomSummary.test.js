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
  it('sends the chosen options once and hands the result on', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        document_id: 'd',
        summary: 'A brief executive summary.',
        cached: true,
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const onGenerated = vi.fn()
    render(createElement(CustomSummary, { id: 'd', onGenerated }))
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Executive' }))
    fireEvent.change(screen.getByLabelText('Focus (optional)'), {
      target: { value: 'risks' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate custom summary' }),
    )
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1))
    expect(onGenerated).toHaveBeenCalledWith({
      summary: 'A brief executive summary.',
      cached: true,
      options: { length: 'short', tone: 'executive', focus: 'risks' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      length: 'short',
      tone: 'executive',
      focus: 'risks',
    })
  })

  it('starts at medium length and a neutral tone', () => {
    render(createElement(CustomSummary, { id: 'd' }))
    expect(screen.getByRole('radio', { name: 'Medium' }).checked).toBe(true)
    expect(screen.getByRole('radio', { name: 'Neutral' }).checked).toBe(true)
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
    const onGenerated = vi.fn()
    render(createElement(CustomSummary, { id: 'd', onGenerated }))
    const button = () =>
      screen.getByRole('button', { name: 'Generate custom summary' })
    fireEvent.click(button())
    expect((await screen.findByRole('alert')).textContent).toMatch(/not ready/)
    expect(onGenerated).not.toHaveBeenCalled()
    fireEvent.click(button())
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1))
    expect(onGenerated.mock.calls[0][0].summary).toBe('Second try.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
