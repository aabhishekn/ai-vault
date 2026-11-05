import { describe, expect, it, vi } from 'vitest'
import { parseAnswer } from './answers'
import { createMultiConversation, sendMessage } from './conversations'

const question = 'Which is cheaper?'
const multiAnswer = {
  document_id: null,
  question,
  answer: 'A costs 5 [1].',
  insufficient_evidence: false,
  citations: [
    {
      document_id: 'doc-a',
      filename: 'a.pdf',
      source_number: 1,
      page_number: 1,
      chunk_id: 'chunk-a',
      text: 'A costs 5.',
    },
  ],
}

describe('multi-document answers', () => {
  it('accepts an answer with no single document and keeps the source names', () => {
    const parsed = parseAnswer(multiAnswer, null, question)
    expect(parsed.document_id).toBeNull()
    expect(parsed.citations[0].filename).toBe('a.pdf')
  })
  it('still requires the document id to match for single-document answers', () => {
    expect(() => parseAnswer(multiAnswer, 'doc-a', question)).toThrow()
    expect(() =>
      parseAnswer({ ...multiAnswer, document_id: 'doc-a' }, null, question),
    ).toThrow()
  })
  it('rejects a source name that is not text', () => {
    const bad = {
      ...multiAnswer,
      citations: [{ ...multiAnswer.citations[0], filename: 7 }],
    }
    expect(() => parseAnswer(bad, null, question)).toThrow()
  })
})

describe('multi-document conversations', () => {
  it('creates a conversation for the chosen documents', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'conv-a', document_id: null }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      createMultiConversation(['doc-a', 'doc-b'], new AbortController().signal),
    ).resolves.toBe('conv-a')
    expect(fetch.mock.calls[0][0]).toBe('/api/multi-conversations')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      document_ids: ['doc-a', 'doc-b'],
    })
  })
  it('rejects a conversation that is tied to one document', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ id: 'c', document_id: 'doc-a' })),
    )
    await expect(
      createMultiConversation(['doc-a', 'doc-b'], new AbortController().signal),
    ).rejects.toThrow('invalid conversation response')
  })
  it('validates a turn without a document id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 'turn-a',
          conversation_id: 'conv-a',
          turn_number: 1,
          response: multiAnswer,
        }),
      ),
    )
    const turn = await sendMessage(
      null,
      'conv-a',
      question,
      new AbortController().signal,
    )
    expect(turn.answer.citations[0].filename).toBe('a.pdf')
  })
})
