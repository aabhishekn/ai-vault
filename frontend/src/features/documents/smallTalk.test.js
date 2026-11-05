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
    "what's up",
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
    'ok',
    'cool',
    'got it',
    'testing',
  ])('answers %j on the spot', (text) => {
    expect(smallTalkReply(text, scope)).toContain(scope)
  })

  it.each([
    'how are yout',
    'how are yu',
    'how r you',
    'helo',
    'hellp',
    'hlelo',
    'hii there',
    'good mornin',
    'thnks',
    'thank yuo',
    'thanx',
    'goodbey',
    'what can u do',
    'wat can you do',
    'alrigth',
    'hey how are yout',
  ])('forgives the typo in %j', (text) => {
    expect(smallTalkReply(text, scope)).not.toBeNull()
  })

  it.each([
    'What does the lease say about fees?',
    'hello, what is the refund policy',
    'help me find the refund deadline',
    'thanks for the summary, what about fees?',
    'who are you referring to in section 2?',
    'say hello to the new hires, who are they?',
    'bye-law 4',
    'hi5',
    'ok 5',
    'hello 2',
    'fees',
    'refund',
    'rent due',
    'goods',
    'yet',
    'nope',
    '',
    '   ',
    '??',
    'x'.repeat(60),
  ])('sends %j to the documents', (text) => {
    expect(smallTalkReply(text, scope)).toBeNull()
  })

  it('does not stretch short words: one slip in "hi" or "ok" is a different word', () => {
    expect(smallTalkReply('ha', scope)).toBeNull()
    expect(smallTalkReply('ox', scope)).toBeNull()
    expect(smallTalkReply('byte', scope)).toBeNull()
  })

  it('words each kind of reply for what is being asked about', () => {
    expect(smallTalkReply('hi', 'your documents')).toMatch(
      /^Hi!.*your documents/,
    )
    expect(smallTalkReply('thanks', scope)).toMatch(/^You're welcome/)
    expect(smallTalkReply('bye', scope)).toMatch(/^Goodbye/)
    expect(smallTalkReply('help', scope)).toMatch(/only what the text says/)
    expect(smallTalkReply('ok', scope)).toMatch(/^Got it/)
    expect(smallTalkReply('how are yout', scope)).toMatch(/^Hi!/)
  })
})
