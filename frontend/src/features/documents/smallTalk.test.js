import { describe, expect, it } from 'vitest'
import { smallTalkReply } from './smallTalk'

const scope = 'this document'

describe('smallTalkReply', () => {
  it.each([
    'hello',
    'Hello!',
    'hey',
    'heyyy',
    'hi there',
    'HI',
    'good morning',
    'hey, how are you?',
    'how are you',
    'thanks',
    'Thank you!',
    'thanks a lot',
    'ok thanks',
    'thx 🙏',
    'bye',
    'Goodbye.',
    'see you',
    'good night',
    'okay bye bye',
    'help',
    'what can you do?',
  ])('answers %j on the spot', (text) => {
    expect(smallTalkReply(text, scope)).toContain(scope)
  })

  it.each([
    'What does the lease say about fees?',
    'hello, what is the refund policy',
    'help me find the refund deadline',
    'thanks for the summary, what about fees?',
    'who are you referring to in section 2?',
    'say hello to the new hires, who are they?',
    'bye-law 4',
    '',
    '   ',
    '??',
    'x'.repeat(60),
  ])('sends %j to the documents', (text) => {
    expect(smallTalkReply(text, scope)).toBeNull()
  })

  it('words each kind of reply for what is being asked about', () => {
    expect(smallTalkReply('hi', 'your documents')).toMatch(
      /^Hi!.*your documents/,
    )
    expect(smallTalkReply('thanks', scope)).toMatch(/^You're welcome/)
    expect(smallTalkReply('bye', scope)).toMatch(/^Goodbye/)
    expect(smallTalkReply('help', scope)).toMatch(/only what the text says/)
  })
})
