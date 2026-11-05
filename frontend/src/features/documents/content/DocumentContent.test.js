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
    let resolve
    const pending = new Promise((done) => {
      resolve = done
    })
    let generated = false
    const fetch = vi.fn((url, options) => {
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
    resolve(Response.json(saved))
    expect(await screen.findByText('A key finding.')).toBeTruthy()
    expect(screen.getByText('Page 2')).toBeTruthy()
    expect(screen.getByText('Evidence from page two.')).toBeTruthy()
    await waitFor(() =>
      expect(globalThis.document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Insights' }),
      ),
    )
    // Nothing to check or refresh while the saved result loads fine.
    expect(screen.queryByRole('button', { name: /^Check saved/ })).toBeNull()
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

  it('shows a custom summary in place of the saved one and goes back to it', async () => {
    const fetch = vi.fn((url, options) =>
      Promise.resolve(
        options?.method === 'POST'
          ? Response.json({
              document_id: document.id,
              summary: 'A short, formal take.',
              cached: true,
            })
          : Response.json({
              document_id: document.id,
              summary: 'Saved summary text.',
            }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentSummary, {
        id: document.id,
        documentStatus: 'embedded',
      }),
    )
    expect(await screen.findByText('Saved summary text.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Formal' }))
    fireEvent.change(screen.getByLabelText('Focus (optional)'), {
      target: { value: 'risks' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate custom summary' }),
    )
    // The custom text takes the saved summary's place, and says what it is.
    expect(await screen.findByText('A short, formal take.')).toBeTruthy()
    expect(screen.queryByText('Saved summary text.')).toBeNull()
    expect(screen.getByText('Custom summary')).toBeTruthy()
    expect(
      screen.getByText(/Short · Formal · Focus: risks · reused from earlier/),
    ).toBeTruthy()
    expect(
      screen.getByText(/Done\. The custom summary is shown above/),
    ).toBeTruthy()
    // Going back needs no request: the saved summary was never replaced.
    const requests = fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Show saved summary' }))
    expect(screen.getByText('Saved summary text.')).toBeTruthy()
    expect(screen.queryByText('A short, formal take.')).toBeNull()
    expect(screen.queryByText('Custom summary')).toBeNull()
    expect(fetch.mock.calls).toHaveLength(requests)
  })
})
