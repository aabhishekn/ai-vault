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
import { ChatThread } from './ChatThread'

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
  const view = render(createElement(ChatThread, { id, documentStatus }))
  // Searchable documents first look for a saved conversation; wait until typing is allowed.
  if (documentStatus === 'embedded')
    await waitFor(() =>
      expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(false),
    )
  return view
}

// An answer's text is split around its clickable source labels, so match the paragraph.
const said = (text) => (_, element) =>
  element?.tagName === 'P' && element.textContent === text

describe('conversation UI', () => {
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
    expect(screen.getByRole('status').textContent).toContain(
      'Searching your documents…',
    )
    await act(async () => {
      resolve(turnResponse('a', question))
    })
    expect(
      await screen.findByText(said('Python is required [1].')),
    ).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByText('[1] · Page 2'))
    expect(screen.getByText('Python is required.')).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox')),
    )
    expect(posts(fetch)).toHaveLength(2)
  })
  it('answers a greeting on the spot, with no request, and clears it for a real question', async () => {
    const fetch = mockApi((asked, call) =>
      Promise.resolve(turnResponse('a', asked, call)),
    )
    await renderChat()
    enter('hello')
    ask()
    expect(
      await screen.findByText(/Ask me anything about this document/),
    ).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.getByText(/no AI request was sent/)).toBeTruthy()
    expect(screen.getByRole('textbox').value).toBe('')
    expect(posts(fetch)).toEqual([])
    enter(question)
    ask()
    expect(
      await screen.findByText(said('Python is required [1].')),
    ).toBeTruthy()
    expect(screen.queryByText(/no AI request was sent/)).toBeNull()
    expect(posts(fetch)).toHaveLength(2)
  })
  it('creates one conversation and sends follow-ups to it, keeping every turn', async () => {
    const fetch = mockApi((asked, call) =>
      Promise.resolve(turnResponse('a', asked, call)),
    )
    await renderChat()
    enter(question)
    ask()
    expect(
      await screen.findByText(said('Python is required [1].')),
    ).toBeTruthy()
    expect(screen.getByRole('textbox').value).toBe('')
    expect(screen.getByText('Your follow-up question')).toBeTruthy()
    enter(followUp)
    ask()
    expect(await screen.findByText(said('SQL is required [1].'))).toBeTruthy()
    expect(screen.getByText(said('Python is required [1].'))).toBeTruthy()
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
    await screen.findByText(said('Python is required [1].'))
    enter(followUp)
    ask()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'couldn’t complete',
    )
    expect(screen.getByText(said('Python is required [1].'))).toBeTruthy()
    expect(screen.getByRole('textbox').value).toBe(followUp)
    ask()
    expect(await screen.findByText(said('SQL is required [1].'))).toBeTruthy()
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
    expect(screen.getByText(/Try naming a topic or detail/)).toBeTruthy()
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
      createElement(ChatThread, {
        key: 'b',
        id: 'b',
        documentStatus: 'embedded',
      }),
    )
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(turnResponse('a', question))
    })
    expect(screen.queryByText(said('Python is required [1].'))).toBeNull()
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
    render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
    expect(screen.getByText('Loading your previous conversation…')).toBeTruthy()
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
    expect(
      await screen.findByText(said('Earlier answer is required [1].')),
    ).toBeTruthy()
    expect(
      screen.getByText(said('Second answer is required [1].')),
    ).toBeTruthy()
    expect(screen.queryByText('Loading your previous conversation…')).toBeNull()
    expect(screen.getByText('Your follow-up question')).toBeTruthy()
    enter(followUp)
    ask()
    await screen.findByText(said('SQL is required [1].'))
    expect(posts(fetch)).toEqual(['/api/conversations/c0/messages/stream'])
  })
  it('puts New chat in the bar above the thread, and keeps it off while an answer is written', async () => {
    mockApi(() => new Promise(() => {}), { saved })
    render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
    await screen.findByText(said('Earlier answer is required [1].'))
    const button = screen.getByRole('button', { name: 'New chat' })
    expect(button.disabled).toBe(false)
    // It sits above the conversation, not beside the question box.
    expect(
      button.compareDocumentPosition(screen.getByRole('log')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    enter(question)
    ask()
    await waitFor(() => expect(button.disabled).toBe(true))
  })
  it('starts a fresh conversation on request while the old one stays saved', async () => {
    const fetch = mockApi(
      (asked) => Promise.resolve(turnResponse('a', asked, 1)),
      { saved },
    )
    render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
    await screen.findByText(said('Earlier answer is required [1].'))
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(
      screen.queryByText(said('Earlier answer is required [1].')),
    ).toBeNull()
    expect(screen.getByText('Your question')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
    enter(question)
    ask()
    await screen.findByText(said('Python is required [1].'))
    expect(posts(fetch)).toEqual([
      '/api/documents/a/conversations',
      '/api/conversations/c1/messages/stream',
    ])
  })
  it('opens at the start of the newest answer, not at a source of an earlier one', async () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      mockApi((asked) => Promise.resolve(turnResponse('a', asked, 1)), {
        saved,
      })
      render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
      await screen.findByText(said('Second answer is required [1].'))
      const target = scrollIntoView.mock.contexts.at(-1)
      expect(target.tagName).toBe('LI')
      expect(target.textContent).toContain('Second answer is required')
    } finally {
      delete window.HTMLElement.prototype.scrollIntoView
    }
  })
  it('lets you ask a new question when nothing is saved or restoring fails', async () => {
    mockApi((asked) => Promise.resolve(turnResponse('a', asked)), {
      restoreStatus: 503,
    })
    await renderChat()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
    enter(question)
    ask()
    expect(
      await screen.findByText(said('Python is required [1].')),
    ).toBeTruthy()
  })
  it('loads history only once per open document', async () => {
    const fetch = mockApi(
      (asked) => Promise.resolve(turnResponse('a', asked)),
      {
        saved,
      },
    )
    const { rerender } = render(
      createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }),
    )
    await screen.findByText(said('Earlier answer is required [1].'))
    const reads = fetch.mock.calls.length
    rerender(createElement(ChatThread, { id: 'a', documentStatus: 'ready' }))
    expect(
      screen.getByText(said('Earlier answer is required [1].')),
    ).toBeTruthy()
    expect(fetch.mock.calls.length).toBe(reads)
  })
})

describe('editing a question', () => {
  const saved = {
    id: 'c0',
    turns: [
      { question: 'Earlier question?', text: 'Earlier answer' },
      { question: 'Earlier follow-up?', text: 'Second answer' },
    ],
  }
  const edited = 'Earlier follow-up, reworded?'
  const editButtons = () =>
    screen.queryAllByRole('button', { name: 'Edit question' })
  const editor = () =>
    screen.getByRole('textbox', { name: 'Edit your question' })
  const sends = (fetch) =>
    fetch.mock.calls
      .filter(([url]) => String(url).endsWith('/messages/stream'))
      .map(([, init]) => JSON.parse(init.body))

  async function open(message) {
    const fetch = mockApi(message, { saved })
    render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
    await screen.findByText(said('Second answer is required [1].'))
    return fetch
  }

  it('offers editing on the last question only', async () => {
    await open(() => new Promise(() => {}))
    expect(editButtons()).toHaveLength(1)
    const last = screen.getByText('Earlier follow-up?').closest('li')
    expect(last.contains(editButtons()[0])).toBe(true)
  })

  it('resends the edited question in place of the old one and drops the old answer', async () => {
    const fetch = await open((asked) =>
      Promise.resolve(turnResponse('a', asked, 2, 'c0')),
    )
    fireEvent.click(editButtons()[0])
    expect(editor().value).toBe('Earlier follow-up?')
    expect(
      screen.queryByText('Earlier follow-up?', { selector: 'p' }),
    ).toBeNull()
    fireEvent.change(editor(), { target: { value: edited } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
    expect(await screen.findByText(said('SQL is required [1].'))).toBeTruthy()
    expect(sends(fetch)).toEqual([{ question: edited, replace_turn: 2 }])
    expect(
      screen.queryByText(said('Second answer is required [1].')),
    ).toBeNull()
    expect(
      screen.getByText(said('Earlier answer is required [1].')),
    ).toBeTruthy()
    expect(screen.getByText(edited)).toBeTruthy()
    expect(
      screen.queryByRole('textbox', { name: 'Edit your question' }),
    ).toBeNull()
    expect(editButtons()).toHaveLength(1)
  })

  it('sends with Enter, and not an empty or unchanged question', async () => {
    const fetch = await open((asked) =>
      Promise.resolve(turnResponse('a', asked, 2, 'c0')),
    )
    fireEvent.click(editButtons()[0])
    const save = screen.getByRole('button', { name: 'Save and resend' })
    expect(save.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(save)
    fireEvent.keyDown(editor(), { key: 'Enter' })
    fireEvent.change(editor(), { target: { value: '   ' } })
    fireEvent.keyDown(editor(), { key: 'Enter' })
    expect(sends(fetch)).toEqual([])
    fireEvent.change(editor(), { target: { value: edited } })
    expect(save.getAttribute('aria-disabled')).toBe('false')
    fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true })
    expect(sends(fetch)).toEqual([])
    fireEvent.keyDown(editor(), { key: 'Enter' })
    await screen.findByText(said('SQL is required [1].'))
    expect(sends(fetch)).toHaveLength(1)
  })

  it('cancels with the button or Escape and sends nothing', async () => {
    const fetch = await open(() => new Promise(() => {}))
    fireEvent.click(editButtons()[0])
    fireEvent.change(editor(), { target: { value: edited } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Earlier follow-up?')).toBeTruthy()
    fireEvent.click(editButtons()[0])
    expect(editor().value).toBe('Earlier follow-up?')
    fireEvent.keyDown(editor(), { key: 'Escape' })
    expect(screen.getByText('Earlier follow-up?')).toBeTruthy()
    expect(
      screen.queryByRole('textbox', { name: 'Edit your question' }),
    ).toBeNull()
    expect(sends(fetch)).toEqual([])
  })

  it('hides the replaced answer while the new one is written, then offers no edit', async () => {
    await open(() => new Promise(() => {}))
    fireEvent.click(editButtons()[0])
    fireEvent.change(editor(), { target: { value: edited } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
    await screen.findByRole('status')
    expect(screen.getByText(edited)).toBeTruthy()
    expect(
      screen.queryByText(said('Second answer is required [1].')),
    ).toBeNull()
    expect(
      screen.getByText(said('Earlier answer is required [1].')),
    ).toBeTruthy()
    expect(editButtons()).toHaveLength(0)
  })

  it('brings the old answer and the edited text back when the resend fails', async () => {
    await open(() => Promise.resolve(Response.json({}, { status: 503 })))
    fireEvent.click(editButtons()[0])
    fireEvent.change(editor(), { target: { value: edited } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'couldn’t complete',
    )
    expect(
      screen.getByText(said('Second answer is required [1].')),
    ).toBeTruthy()
    expect(editor().value).toBe(edited)
  })

  it('closes the editor when a new question is asked instead', async () => {
    await open((asked) => Promise.resolve(turnResponse('a', asked, 3, 'c0')))
    fireEvent.click(editButtons()[0])
    fireEvent.change(screen.getByLabelText('Your follow-up question'), {
      target: { value: followUp },
    })
    ask()
    await screen.findByText(said('SQL is required [1].'))
    expect(
      screen.queryByRole('textbox', { name: 'Edit your question' }),
    ).toBeNull()
    expect(screen.getByText('Earlier follow-up?')).toBeTruthy()
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
      createElement(ChatThread, {
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
      createElement(ChatThread, {
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
    render(createElement(ChatThread, { id: 'a', documentStatus: 'embedded' }))
    fireEvent.change(await screen.findByLabelText('Your question'), {
      target: { value: question },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }))
    expect(await screen.findByText('Python is')).toBeTruthy()
    expect(screen.queryByText(/Sources$/)).toBeNull()
    await act(async () => finish?.())
    expect(
      await screen.findByText(said('Python is required [1].')),
    ).toBeTruthy()
    expect(screen.getByText('Sources')).toBeTruthy()
    expect(screen.queryByText(/Answering/)).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('across several documents', () => {
  const starters = ['What do these have in common?']

  function mockMulti() {
    const fetch = vi.fn((url, init) => {
      if (/\/multi-conversations$/.test(url))
        return Promise.resolve(
          Response.json({ id: 'm1', document_id: null }, { status: 201 }),
        )
      const turn = Response.json({
        id: 't1',
        conversation_id: 'm1',
        turn_number: 1,
        response: {
          document_id: null,
          question: JSON.parse(String(init.body)).question,
          answer: 'Both mention fees [1][2].',
          insufficient_evidence: false,
          citations: [1, 2].map((number) => ({
            source_number: number,
            filename: number === 1 ? 'lease.pdf' : 'budget.pdf',
            page_number: number,
            chunk_id: `chunk-${number}`,
            text: 'A fee applies.',
          })),
        },
      })
      return asEventStream(turn)
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('offers starters that fill the box, then asks one conversation over the documents', async () => {
    const fetch = mockMulti()
    render(createElement(ChatThread, { documentIds: ['d1', 'd2'], starters }))
    // No document of its own, so there is no saved conversation to look for.
    expect(
      fetch.mock.calls.filter(([url]) => /conversations\?/.test(url)),
    ).toHaveLength(0)
    expect(
      screen.queryByRole('button', { name: 'Suggest questions' }),
    ).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'What do these have in common?' }),
    )
    expect(screen.getByRole('textbox').value).toBe(
      'What do these have in common?',
    )
    ask()

    expect(await screen.findByText(/Both mention fees/)).toBeTruthy()
    const created = fetch.mock.calls.find(([url]) =>
      /multi-conversations$/.test(url),
    )
    expect(JSON.parse(created[1].body)).toEqual({ document_ids: ['d1', 'd2'] })
    // Each source says which document it came from.
    expect(screen.getAllByText(/lease/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/budget/).length).toBeGreaterThan(0)
  })

  it('sends Enter as the question and keeps Shift+Enter for a new line', async () => {
    mockMulti()
    render(createElement(ChatThread, { documentIds: ['d1', 'd2'], starters }))
    enter('Anything about fees?')
    const box = screen.getByRole('textbox')
    // Shift+Enter is not a submit, so no request has gone out.
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/Both mention fees/)).toBeTruthy()
  })
})
