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
const followUp = 'And what else?'

function answerFor(documentId: string, asked: string, text = 'Python') {
  return {
    document_id: documentId,
    question: asked,
    answer: `${text} is required [1].`,
    insufficient_evidence: false,
    citations: [
      {
        source_number: 1,
        page_number: 2,
        chunk_id: 'chunk-a',
        text: `${text} is required.`,
      },
    ],
  }
}

// Routes the two conversation endpoints; `message` supplies each turn's response.
function mockApi(message: (asked: string, call: number) => Promise<Response>) {
  let calls = 0
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const created = /documents\/([^/]+)\/conversations$/.exec(url)
    if (created)
      return Promise.resolve(
        Response.json({ id: 'c1', document_id: created[1] }),
      )
    const body = JSON.parse(String(init?.body)) as { question: string }
    const call = ++calls
    return message(body.question, call)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function turnResponse(documentId: string, asked: string, number = 1) {
  return Response.json({
    id: `t${number}`,
    conversation_id: 'c1',
    turn_number: number,
    response: answerFor(documentId, asked, number === 1 ? 'Python' : 'SQL'),
  })
}

function enter(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

function ask() {
  fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
}

function renderChat(
  id = 'a',
  documentStatus: 'embedded' | 'extracted' = 'embedded',
) {
  return render(createElement(DocumentQuestion, { id, documentStatus }))
}

describe('document conversation UI', () => {
  it('only submits on demand, blocks duplicates, renders evidence, and returns focus', async () => {
    let resolve!: (response: Response) => void
    const fetch = mockApi(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    renderChat()
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText(/API charges may apply/)).toBeTruthy()
    enter(question)
    const submit = screen.getByRole('button', { name: 'Ask question' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Finding an answer…' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    await act(async () => {
      resolve(turnResponse('a', question))
    })
    expect(await screen.findByText('Python is required [1].')).toBeTruthy()
    fireEvent.click(screen.getByText('[1] · Page 2'))
    expect(screen.getByText('Python is required.')).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox')),
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('creates one conversation and sends follow-ups to it, keeping every turn', async () => {
    const fetch = mockApi((asked, call) =>
      Promise.resolve(turnResponse('a', asked, call)),
    )
    renderChat()
    enter(question)
    ask()
    expect(await screen.findByText('Python is required [1].')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText('Your follow-up question')).toBeTruthy()
    enter(followUp)
    ask()
    expect(await screen.findByText('SQL is required [1].')).toBeTruthy()
    expect(screen.getByText('Python is required [1].')).toBeTruthy()
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      '/api/documents/a/conversations',
      '/api/conversations/c1/messages',
      '/api/conversations/c1/messages',
    ])
  })
  it('keeps the draft and earlier turns when a follow-up fails, then allows a retry', async () => {
    mockApi((asked, call) =>
      call === 2
        ? Promise.resolve(Response.json({}, { status: 503 }))
        : Promise.resolve(turnResponse('a', asked, call === 3 ? 2 : call)),
    )
    renderChat()
    enter(question)
    ask()
    await screen.findByText('Python is required [1].')
    enter(followUp)
    ask()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'couldn’t complete',
    )
    expect(screen.getByText('Python is required [1].')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      followUp,
    )
    ask()
    expect(await screen.findByText('SQL is required [1].')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('explains and blocks questions when text is not indexed', () => {
    const fetch = mockApi(() => Promise.reject(new Error('unexpected')))
    renderChat('a', 'extracted')
    expect(screen.getByText(/Questions need indexed/)).toBeTruthy()
    ask()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects whitespace locally and never retries a failed request automatically', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    renderChat()
    ask()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enter a question about this document.',
    )
    expect(fetch).not.toHaveBeenCalled()
    enter(question)
    ask()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'couldn’t complete',
      ),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('shows insufficient evidence without implying supporting citations exist', async () => {
    mockApi((asked) =>
      Promise.resolve(
        Response.json({
          id: 't1',
          conversation_id: 'c1',
          turn_number: 1,
          response: {
            ...answerFor('a', asked),
            insufficient_evidence: true,
            answer: 'Not enough evidence.',
            citations: [],
          },
        }),
      ),
    )
    renderChat()
    enter(question)
    ask()
    expect(
      await screen.findByRole('heading', { name: 'Not enough evidence' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull()
  })
  it('aborts pending work when the conversation unmounts', () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)
    const { unmount } = renderChat()
    enter(question)
    ask()
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
  it('ignores a late answer after switching documents', async () => {
    let resolve!: (response: Response) => void
    const fetch = mockApi(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    const { rerender } = renderChat('a')
    enter(question)
    ask()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const signal = fetch.mock.calls[1]![1]?.signal as AbortSignal
    rerender(
      createElement(DocumentQuestion, {
        key: 'b',
        id: 'b',
        documentStatus: 'embedded',
      }),
    )
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(turnResponse('a', question))
    })
    expect(screen.queryByText('Python is required [1].')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })
})
