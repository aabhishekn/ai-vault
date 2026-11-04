import { describe, expect, it, vi } from 'vitest'
import {
  createConversation,
  getLatestConversation,
  sendMessage,
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
  const history = (turns: unknown[]) => ({
    id: conversationId,
    document_id: documentId,
    turns,
  })
  const savedTurn = (number: number, extra = {}) => ({
    id: `turn-${number}`,
    conversation_id: conversationId,
    turn_number: number,
    response: { ...answer, ...extra },
  })
  const respond = (...bodies: unknown[]) => {
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
