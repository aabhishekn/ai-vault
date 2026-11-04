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

function answerFor(documentId, asked, text = 'Python') {
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

// The chat endpoint streams: turn the JSON a test supplies into the events the server sends.
async function asEventStream(response) {
  if (!response.ok) return response
  const turn = await response.json()
  const event = (name, data) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
  return new Response(
    event('delta', { text: 'Working on it' }) + event('turn', turn),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

// Routes the conversation endpoints; `message` supplies each new turn's response.
function mockApi(message, { saved, restoreStatus } = {}) {
  let calls = 0
  const fetch = vi.fn((url, init) => {
    const isPost = init?.method === 'POST'
    const list = /documents\/([^/]+)\/conversations\?/.exec(url)
    if (list) {
      if (restoreStatus)
        return Promise.resolve(Response.json({}, { status: restoreStatus }))
      return Promise.resolve(
        Response.json({
          items: saved
            ? [
                {
                  id: saved.id,
                  document_id: list[1],
                  turn_count: saved.turns.length,
                  created_at: '2026-11-04T00:00:00Z',
                },
              ]
            : [],
          total: saved ? 1 : 0,
          limit: 1,
          offset: 0,
        }),
      )
    }
    const history = /conversations\/([^/?]+)\?/.exec(url)
    if (history && !isPost && saved)
      return Promise.resolve(
        Response.json({
          id: saved.id,
          document_id: 'a',
          turns: saved.turns.map((turn, index) => ({
            id: `saved-${index}`,
            conversation_id: saved.id,
            turn_number: index + 1,
            response: answerFor('a', turn.question, turn.text),
            created_at: '2026-11-04T00:00:00Z',
          })),
          total: saved.turns.length,
          limit: 100,
          offset: 0,
        }),
      )
    const created = /documents\/([^/]+)\/conversations$/.exec(url)
    if (created)
      return Promise.resolve(
        Response.json({ id: 'c1', document_id: created[1] }),
      )
    const body = JSON.parse(String(init?.body))
    const call = ++calls
    return message(body.question, call).then(asEventStream)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const posts = (fetch) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url]) => url)

function turnResponse(documentId, asked, number = 1, conversationId = 'c1') {
  return Response.json({
    id: `t${number}`,
    conversation_id: conversationId,
    turn_number: number,
    response: answerFor(documentId, asked, number === 1 ? 'Python' : 'SQL'),
  })
}

function enter(text) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

function ask() {
  fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
}

async function renderChat(id = 'a', documentStatus = 'embedded') {
  const view = render(createElement(DocumentQuestion, { id, documentStatus }))
  // Searchable documents first look for a saved conversation; wait until typing is allowed.
  if (documentStatus === 'embedded')
    await waitFor(() =>
      expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(false),
    )
  return view
}

describe('document conversation UI', () => {
  it('only submits on demand, blocks duplicates, renders evidence, and returns focus', async () => {
    let resolve
    const fetch = mockApi(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await renderChat()
    expect(posts(fetch)).toEqual([])
    expect(screen.getByText(/API charges may apply/)).toBeTruthy()
    enter(question)
    const submit = screen.getByRole('button', { name: 'Ask question' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(posts(fetch)).toHaveLength(2))
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
    expect(posts(fetch)).toHaveLength(2)
  })
  it('creates one conversation and sends follow-ups to it, keeping every turn', async () => {
    const fetch = mockApi((asked, call) =>
      Promise.resolve(turnResponse('a', asked, call)),
    )
    await renderChat()
    enter(question)
    ask()
    expect(await screen.findByText('Python is required [1].')).toBeTruthy()
    expect(screen.getByRole('textbox').value).toBe('')
    expect(screen.getByText('Your follow-up question')).toBeTruthy()
    enter(followUp)
    ask()
    expect(await screen.findByText('SQL is required [1].')).toBeTruthy()
    expect(screen.getByText('Python is required [1].')).toBeTruthy()
    expect(posts(fetch)).toEqual([
      '/api/documents/a/conversations',
      '/api/conversations/c1/messages/stream',
      '/api/conversations/c1/messages/stream',
    ])
  })
  it('keeps the draft and earlier turns when a follow-up fails, then allows a retry', async () => {
    mockApi((asked, call) =>
      call === 2
        ? Promise.resolve(Response.json({}, { status: 503 }))
        : Promise.resolve(turnResponse('a', asked, call === 3 ? 2 : call)),
    )
    await renderChat()
    enter(question)
    ask()
    await screen.findByText('Python is required [1].')
    enter(followUp)
    ask()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'couldn’t complete',
    )
    expect(screen.getByText('Python is required [1].')).toBeTruthy()
    expect(screen.getByRole('textbox').value).toBe(followUp)
    ask()
    expect(await screen.findByText('SQL is required [1].')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('explains and blocks questions when text is not indexed, without looking for history', async () => {
    const fetch = mockApi(() => Promise.reject(new Error('unexpected')))
    await renderChat('a', 'extracted')
    expect(screen.getByText(/Questions need indexed/)).toBeTruthy()
    ask()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects whitespace locally and never retries a failed request automatically', async () => {
    const fetch = mockApi(() => Promise.reject(new TypeError('Disconnected')))
    await renderChat()
    ask()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enter a question about this document.',
    )
    expect(posts(fetch)).toEqual([])
    enter(question)
    ask()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'couldn’t complete',
      ),
    )
    expect(posts(fetch)).toHaveLength(2)
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
    await renderChat()
    enter(question)
    ask()
    expect(
      await screen.findByRole('heading', { name: 'Not enough evidence' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull()
  })
  it('aborts pending work when the conversation unmounts', async () => {
    const fetch = mockApi(() => new Promise(() => {}))
    const { unmount } = await renderChat()
    enter(question)
    ask()
    await waitFor(() => expect(posts(fetch)).toHaveLength(2))
    const messageCall = fetch.mock.calls.find(([url]) =>
      String(url).endsWith('/messages/stream'),
    )
    const signal = messageCall[1].signal
    unmount()
    expect(signal.aborted).toBe(true)
  })
  it('ignores a late answer after switching documents', async () => {
    let resolve
    const fetch = mockApi(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { rerender } = await renderChat('a')
    enter(question)
    ask()
    await waitFor(() => expect(posts(fetch)).toHaveLength(2))
    const messageCall = fetch.mock.calls.find(([url]) =>
      String(url).endsWith('/messages/stream'),
    )
    const signal = messageCall[1].signal
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
    await waitFor(() =>
      expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(false),
    )
    expect(screen.getByRole('textbox').value).toBe('')
  })
})

describe('restoring a saved conversation', () => {
  const saved = {
    id: 'c0',
    turns: [
      { question: 'Earlier question?', text: 'Earlier answer' },
      { question: 'Earlier follow-up?', text: 'Second answer' },
    ],
  }

  it('shows saved turns on open and sends the next question to the same conversation', async () => {
    const fetch = mockApi(
      (asked) => Promise.resolve(turnResponse('a', asked, 3, 'c0')),
      { saved },
    )
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    expect(screen.getByText('Loading your previous conversation…')).toBeTruthy()
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
    expect(
      await screen.findByText('Earlier answer is required [1].'),
    ).toBeTruthy()
    expect(screen.getByText('Second answer is required [1].')).toBeTruthy()
    expect(screen.queryByText('Loading your previous conversation…')).toBeNull()
    expect(screen.getByText('Your follow-up question')).toBeTruthy()
    enter(followUp)
    ask()
    await screen.findByText('SQL is required [1].')
    expect(posts(fetch)).toEqual(['/api/conversations/c0/messages/stream'])
  })
  it('starts a fresh conversation on request while the old one stays saved', async () => {
    const fetch = mockApi(
      (asked) => Promise.resolve(turnResponse('a', asked, 1)),
      { saved },
    )
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    await screen.findByText('Earlier answer is required [1].')
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.queryByText('Earlier answer is required [1].')).toBeNull()
    expect(screen.getByText('Your question')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'New conversation' }),
    ).toBeNull()
    enter(question)
    ask()
    await screen.findByText('Python is required [1].')
    expect(posts(fetch)).toEqual([
      '/api/documents/a/conversations',
      '/api/conversations/c1/messages/stream',
    ])
  })
  it('lets you ask a new question when nothing is saved or restoring fails', async () => {
    mockApi((asked) => Promise.resolve(turnResponse('a', asked)), {
      restoreStatus: 503,
    })
    await renderChat()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'New conversation' }),
    ).toBeNull()
    enter(question)
    ask()
    expect(await screen.findByText('Python is required [1].')).toBeTruthy()
  })
  it('loads history only once per open document', async () => {
    const fetch = mockApi(
      (asked) => Promise.resolve(turnResponse('a', asked)),
      {
        saved,
      },
    )
    const { rerender } = render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    await screen.findByText('Earlier answer is required [1].')
    const reads = fetch.mock.calls.length
    rerender(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'ready' }),
    )
    expect(screen.getByText('Earlier answer is required [1].')).toBeTruthy()
    expect(fetch.mock.calls.length).toBe(reads)
  })
})

describe('suggested questions', () => {
  it('offers suggestions that fill the question box without sending it', async () => {
    const fetch = vi.fn((url) => {
      if (url.endsWith('/suggested-questions'))
        return Promise.resolve(
          Response.json({ questions: ['What is the deadline?'] }),
        )
      return Promise.resolve(Response.json({ items: [], total: 0 }))
    })
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentQuestion, {
        id: 'document-a',
        documentStatus: 'embedded',
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Suggest questions' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'What is the deadline?' }),
    )
    expect(screen.getByLabelText('Your question').value).toBe(
      'What is the deadline?',
    )
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).endsWith('/messages/stream'),
      ),
    ).toBe(false)
    vi.unstubAllGlobals()
  })

  it('shows a readable message when suggestions are unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(
          url.endsWith('/suggested-questions')
            ? new Response('{}', { status: 409 })
            : Response.json({ items: [], total: 0 }),
        ),
      ),
    )
    render(
      createElement(DocumentQuestion, {
        id: 'document-b',
        documentStatus: 'embedded',
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Suggest questions' }),
    )
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('summary or insights first'),
    )
    vi.unstubAllGlobals()
  })
})

describe('streaming answers', () => {
  it('shows the answer as it is written, then replaces it with the cited answer', async () => {
    let finish
    const encoder = new TextEncoder()
    vi.stubGlobal(
      'fetch',
      vi.fn((url, init) => {
        if (/conversations\?/.test(url))
          return Promise.resolve(Response.json({ items: [] }))
        if (
          init?.method === 'POST' &&
          /documents\/[^/]+\/conversations$/.test(url)
        )
          return Promise.resolve(Response.json({ id: 'c1', document_id: 'a' }))
        const turn = {
          id: 't1',
          conversation_id: 'c1',
          turn_number: 1,
          response: answerFor('a', question),
        }
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `event: delta\ndata: ${JSON.stringify({ text: 'Python is' })}\n\n`,
                  ),
                )
                finish = () => {
                  controller.enqueue(
                    encoder.encode(
                      `event: turn\ndata: ${JSON.stringify(turn)}\n\n`,
                    ),
                  )
                  controller.close()
                }
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        )
      }),
    )
    render(
      createElement(DocumentQuestion, { id: 'a', documentStatus: 'embedded' }),
    )
    fireEvent.change(await screen.findByLabelText('Your question'), {
      target: { value: question },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(await screen.findByText('Python is')).toBeTruthy()
    expect(screen.queryByText(/Sources$/)).toBeNull()
    await act(async () => finish?.())
    expect(await screen.findByText('Python is required [1].')).toBeTruthy()
    expect(screen.getByText('Sources')).toBeTruthy()
    expect(screen.queryByText(/Answering/)).toBeNull()
    vi.unstubAllGlobals()
  })
})
