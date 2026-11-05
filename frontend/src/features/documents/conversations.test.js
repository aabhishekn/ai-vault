import { describe, expect, it, vi } from 'vitest'
import {
  createConversation,
  getLatestConversation,
  sendMessage,
  sendMessageStream,
} from './conversations'

const documentId = 'document-a'
const conversationId = 'conversation-a'
const question = 'What is required?'
const citation = {
  source_number: 1,
  page_number: 2,
  chunk_id: 'chunk-a',
  text: 'Python is required.',
}
const answer = {
  document_id: documentId,
  question,
  answer: 'Python is required [1].',
  insufficient_evidence: false,
  citations: [citation],
}
const turn = {
  id: 'turn-a',
  conversation_id: conversationId,
  turn_number: 1,
  response: answer,
}
const signal = () => new AbortController().signal

describe('conversation API', () => {
  it('creates a conversation for a document with a POST and no body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: conversationId, document_id: documentId }),
      )
    vi.stubGlobal('fetch', fetch)
    const abort = signal()
    await expect(createConversation(documentId, abort)).resolves.toBe(
      conversationId,
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${documentId}/conversations`,
      {
        method: 'POST',
        signal: abort,
        headers: { Accept: 'application/json' },
      },
    )
  })
  it.each([
    null,
    {},
    { id: ' ', document_id: documentId },
    { id: conversationId, document_id: 'another-document' },
  ])('rejects a malformed created conversation', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(createConversation(documentId, signal())).rejects.toThrow(
      'invalid conversation response',
    )
  })
  it('posts a trimmed question and returns the validated turn', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(turn))
    vi.stubGlobal('fetch', fetch)
    const abort = signal()
    await expect(
      sendMessage(documentId, conversationId, `  ${question}  `, abort),
    ).resolves.toEqual({ id: 'turn-a', turnNumber: 1, answer })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ question, top_k: 3 }),
        signal: abort,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    )
  })
  it('accepts an explicit insufficient-evidence answer without sources', async () => {
    const response = {
      ...answer,
      insufficient_evidence: true,
      answer: 'Not enough evidence.',
      citations: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...turn, response })),
    )
    await expect(
      sendMessage(documentId, conversationId, question, signal()),
    ).resolves.toMatchObject({ answer: response })
  })
  it.each([
    null,
    {},
    { ...turn, conversation_id: 'another-conversation' },
    { ...turn, turn_number: 1.5 },
    { ...turn, response: null },
    { ...turn, response: { ...answer, document_id: 'another-document' } },
    { ...turn, response: { ...answer, question: 'Another question' } },
    { ...turn, response: { ...answer, answer: ' ' } },
    { ...turn, response: { ...answer, citations: [] } },
    { ...turn, response: { ...answer, citations: [citation, citation] } },
    { ...turn, response: { ...answer, answer: 'Unsupported answer [2].' } },
    { ...turn, response: { ...answer, insufficient_evidence: true } },
    ...[
      { ...citation, source_number: 0 },
      { ...citation, page_number: 1.5 },
      { ...citation, text: ' ' },
      { ...citation, chunk_id: '' },
    ].map((item) => ({ ...turn, response: { ...answer, citations: [item] } })),
  ])('rejects mismatched turns and malformed citations', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(
      sendMessage(documentId, conversationId, question, signal()),
    ).rejects.toThrow(/invalid (answer or citations|conversation response)/)
  })
  it.each([
    [404, 'could not be found'],
    [409, 'conversation changed'],
    [422, 'not accepted'],
    [502, 'couldn’t complete'],
    [503, 'couldn’t complete'],
  ])('handles HTTP %i safely without retrying', async (status, message) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ detail: 'private provider details' }, { status }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      sendMessage(documentId, conversationId, question, signal()),
    ).rejects.toThrow(message)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not retry a failed connection', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Disconnected'))
    vi.stubGlobal('fetch', fetch)
    await expect(
      sendMessage(documentId, conversationId, question, signal()),
    ).rejects.toThrow('couldn’t complete')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['', '  ', 'x'.repeat(2001)])(
    'rejects invalid questions before sending a request',
    async (invalid) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(
        sendMessage(documentId, conversationId, invalid, signal()),
      ).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})

describe('latest saved conversation', () => {
  const summary = {
    id: conversationId,
    document_id: documentId,
    turn_count: 2,
    created_at: '2026-11-04T00:00:00Z',
  }
  const history = (turns) => ({
    id: conversationId,
    document_id: documentId,
    turns,
  })
  const savedTurn = (number, extra = {}) => ({
    id: `turn-${number}`,
    conversation_id: conversationId,
    turn_number: number,
    response: { ...answer, ...extra },
  })
  const respond = (...bodies) => {
    const fetch = vi.fn()
    for (const body of bodies) fetch.mockResolvedValueOnce(Response.json(body))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('returns null when the document has no answered conversations', async () => {
    const fetch = respond({ items: [], total: 0, limit: 1, offset: 0 })
    await expect(
      getLatestConversation(documentId, signal()),
    ).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/documents/${documentId}/conversations?limit=1&has_turns=true`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })
  it('loads the newest conversation with its validated turns', async () => {
    const fetch = respond(
      { items: [summary], total: 1, limit: 1, offset: 0 },
      history([savedTurn(1), savedTurn(2)]),
    )
    const result = await getLatestConversation(documentId, signal())
    expect(result?.id).toBe(conversationId)
    expect(result?.turns.map((turn) => turn.turnNumber)).toEqual([1, 2])
    expect(result?.turns[0]?.answer).toEqual(answer)
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `/api/conversations/${conversationId}?limit=100&offset=0`,
    )
  })
  it('requests the last page when a conversation has more than 100 turns', async () => {
    const fetch = respond(
      { items: [{ ...summary, turn_count: 130 }] },
      history([savedTurn(31)]),
    )
    await getLatestConversation(documentId, signal())
    expect(fetch.mock.calls[1]?.[0]).toContain('offset=30')
  })
  it.each([
    [null],
    [{}],
    [{ items: [{ ...summary, document_id: 'another-document' }] }],
    [{ items: [{ ...summary, turn_count: 0 }] }],
    [{ items: [{ ...summary, id: ' ' }] }],
  ])('rejects a malformed conversation list', async (list) => {
    respond(list)
    await expect(getLatestConversation(documentId, signal())).rejects.toThrow(
      'invalid conversation response',
    )
  })
  it.each([
    [null],
    [{ ...history([]), id: 'another-conversation' }],
    [{ id: conversationId }],
    [history([{ ...savedTurn(1), response: null }])],
    [history([savedTurn(1, { citations: [] })])],
    [history([savedTurn(1, { document_id: 'another-document' })])],
  ])('rejects malformed saved history', async (body) => {
    respond({ items: [summary] }, body)
    await expect(getLatestConversation(documentId, signal())).rejects.toThrow()
  })
})

describe('streamed messages', () => {
  const turnEvent = `event: turn\ndata: ${JSON.stringify(turn)}\n\n`
  const delta = (text) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`

  // Delivers the body in tiny pieces so events straddle chunk boundaries.
  function streamOf(text, size, status = 200) {
    const bytes = new TextEncoder().encode(text)
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += size)
            controller.enqueue(bytes.slice(i, i + size))
          controller.close()
        },
      }),
      { status, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }

  const run = (response, onText = vi.fn()) => {
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)
    return {
      fetch,
      onText,
      result: sendMessageStream(
        documentId,
        conversationId,
        question,
        signal(),
        onText,
      ),
    }
  }

  it.each([1, 7, 1000])(
    'reports text as it arrives and returns the saved turn (%i-byte chunks)',
    async (size) => {
      const { fetch, onText, result } = run(
        streamOf(delta('Python ') + delta('café ') + turnEvent, size),
      )
      await expect(result).resolves.toMatchObject({
        id: 'turn-a',
        answer: { answer: 'Python is required [1].' },
      })
      expect(onText.mock.calls.map(([text]) => text)).toEqual([
        'Python ',
        'café ',
      ])
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `/api/conversations/${conversationId}/messages/stream`,
      )
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    },
  )

  it('rejects a stream that ends before the saved turn arrives', async () => {
    const { result } = run(streamOf(delta('Partial'), 5))
    await expect(result).rejects.toThrow(/invalid conversation response/)
  })

  it('turns a server error event into a readable error', async () => {
    const error = `event: error\ndata: ${JSON.stringify({ detail: 'x', status: 409 })}\n\n`
    const { result } = run(streamOf(delta('Hi') + error, 4))
    await expect(result).rejects.toThrow(/not ready for questions/)
  })

  it('maps HTTP errors before the stream starts', async () => {
    const { result } = run(new Response('{}', { status: 404 }))
    await expect(result).rejects.toThrow(/could not be found/)
  })

  it.each([
    [undefined, { question, top_k: 3 }],
    [null, { question, top_k: 3 }],
    [2, { question, top_k: 3, replace_turn: 2 }],
  ])('sends replace_turn only for an edit (%s)', async (replaceTurn, body) => {
    const fetch = vi.fn().mockResolvedValue(streamOf(turnEvent, 1000))
    vi.stubGlobal('fetch', fetch)
    await sendMessageStream(
      documentId,
      conversationId,
      question,
      signal(),
      vi.fn(),
      replaceTurn,
    )
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body)
  })

  it('rejects a turn for another conversation', async () => {
    const wrong = `event: turn\ndata: ${JSON.stringify({ ...turn, conversation_id: 'other' })}\n\n`
    const { result } = run(streamOf(wrong, 50))
    await expect(result).rejects.toThrow(/invalid conversation response/)
  })
})
