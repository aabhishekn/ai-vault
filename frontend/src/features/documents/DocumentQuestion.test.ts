// @vitest-environment jsdom
import { createElement } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentQuestion } from './DocumentQuestion'

afterEach(cleanup)
const question = 'What is required?'
const answer = {
  document_id: 'a',
  question,
  answer: 'Python is required [1].',
  insufficient_evidence: false,
  citations: [
    {
      source_number: 1,
      page_number: 2,
      chunk_id: 'chunk-a',
      text: 'Python is required.',
    },
  ],
}

function enterQuestion() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), {
    target: { value: question },
  })
}

describe('document questions UI', () => {
  it('only submits on demand, blocks duplicates, renders evidence, and returns focus', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.fn().mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText(/API charges may apply/)).toBeTruthy()
    enterQuestion()
    const submit = screen.getByRole('button', { name: 'Ask question' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Finding an answer…' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    resolve(Response.json(answer))
    expect(await screen.findByText(answer.answer)).toBeTruthy()
    const source = screen.getByText('[1] · Page 2')
    fireEvent.click(source)
    expect(screen.getByText('Python is required.')).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Ask this document' }),
      ),
    )
  })
  it('explains and blocks questions when text is not indexed', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'extracted' }),
    )
    expect(screen.getByText(/Questions need indexed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects whitespace locally and never retries a failed request automatically', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'ready' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enter a question about this document.',
    )
    expect(fetch).not.toHaveBeenCalled()
    enterQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'couldn’t complete',
      ),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('shows insufficient evidence without implying supporting citations exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...answer,
          insufficient_evidence: true,
          answer: 'Not enough evidence.',
          citations: [],
        }),
      ),
    )
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    enterQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(
      await screen.findByRole('heading', { name: 'Not enough evidence' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull()
  })
  it('aborts pending work when the question section unmounts', () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)
    const { unmount } = render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    enterQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
  it('keeps an answer associated with its submitted question when the next draft changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(answer)))
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    enterQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(await screen.findByText(answer.answer)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'A new question?' },
    })
    expect(screen.getByText(question)).toBeTruthy()
  })
  it('ignores a late answer after switching documents', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.fn().mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const { rerender } = render(
      createElement(DocumentQuestion, {
        key: 'a',
        id: 'a',
        documentStatus: 'embedded',
      }),
    )
    enterQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal
    rerender(
      createElement(DocumentQuestion, {
        key: 'b',
        id: 'b',
        documentStatus: 'embedded',
      }),
    )
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(Response.json(answer))
    })
    expect(screen.queryByText(answer.answer)).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })
})
