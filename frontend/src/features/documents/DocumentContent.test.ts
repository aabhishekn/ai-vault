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
import { DocumentInsights } from './DocumentInsights'
import { DocumentSummary } from './DocumentSummary'

afterEach(cleanup)

const document = {
  id: 'document-a',
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 100,
  status: 'extracted',
  created_at: '2026-11-04T06:00:00Z',
}

describe('generated content UI', () => {
  it('explains insight generation, posts on click, shows citations, and restores focus', async () => {
    const saved = {
      document_id: document.id,
      insights: [
        {
          text: 'A key finding.',
          page_number: 2,
          evidence: 'Evidence from page two.',
        },
      ],
    }
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => {
      resolve = done
    })
    let generated = false
    const fetch = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        generated = true
        return pending
      }
      if (url.endsWith('/insights'))
        return Promise.resolve(
          generated ? Response.json(saved) : Response.json({}, { status: 404 }),
        )
      return Promise.resolve(Response.json(document))
    })
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentInsights, {
        id: document.id,
        documentStatus: 'extracted',
      }),
    )
    const generate = await screen.findByRole('button', {
      name: 'Generate insights',
    })
    expect(screen.getByText(/API charges may apply/)).toBeTruthy()
    expect(
      fetch.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0)
    fireEvent.click(generate)
    expect(
      screen
        .getByRole('button', { name: 'Generating…' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Refresh insights' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    resolve(Response.json(saved))
    expect(await screen.findByText('A key finding.')).toBeTruthy()
    expect(screen.getByText('Page 2')).toBeTruthy()
    expect(screen.getByText('Evidence from page two.')).toBeTruthy()
    await waitFor(() =>
      expect(globalThis.document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Insights' }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh insights' }))
    expect(await screen.findByText('A key finding.')).toBeTruthy()
    expect(
      fetch.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
  })

  it('continues to render saved summaries through the shared lifecycle', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        document_id: document.id,
        summary: 'Saved summary text.',
      }),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentSummary, {
        id: document.id,
        documentStatus: 'embedded',
      }),
    )
    expect(await screen.findByText('Saved summary text.')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Generate summary' }),
    ).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
