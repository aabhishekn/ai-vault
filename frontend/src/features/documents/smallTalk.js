// Messages that are only a greeting, thanks, goodbye, an acknowledgement or a "what can you
// do?". The documents have nothing to say to these, so sending one would cost a model call
// just to be told "not enough evidence". They are answered on the spot instead, and never
// sent. A typo such as "helo" or "how are yout" still counts.
const MAX_LENGTH = 40

// Every way of saying each kind of thing, written out. A message must be one of these whole.
const combine = (starts, middles, ends) =>
  starts.flatMap((start) =>
    middles.flatMap((middle) => ends.map((end) => start + middle + end)),
  )

const PHRASES = {
  greeting: [
    ...combine(
      [
        'hi',
        'hello',
        'hey',
        'hiya',
        'howdy',
        'yo',
        'sup',
        'hola',
        'namaste',
        'greetings',
      ],
      ['', ' there', ' all', ' everyone', ' team'],
      ['', ' how are you', ' how are you doing', ' how are you today'],
    ),
    'good morning',
    'good afternoon',
    'good evening',
    'how are you',
    'how are you doing',
    'how are you today',
    'how r u',
    'how r you',
    'whats up',
    'wassup',
    'how is it going',
    'hows it going',
  ],
  thanks: combine(
    ['', 'ok ', 'okay ', 'great ', 'cool '],
    [
      'thanks',
      'thank you',
      'thank u',
      'thx',
      'thanx',
      'ty',
      'cheers',
      'many thanks',
      'much appreciated',
    ],
    ['', ' a lot', ' so much', ' very much', ' again'],
  ),
  goodbye: combine(
    ['', 'ok ', 'okay '],
    [
      'bye',
      'goodbye',
      'good bye',
      'good night',
      'see you',
      'see ya',
      'cya',
      'take care',
      'farewell',
    ],
    ['', ' bye', ' now', ' later', ' soon', ' then'],
  ),
  help: [
    'help',
    'what can you do',
    'what do you do',
    'who are you',
    'how does this work',
  ],
  ack: [
    'ok',
    'okay',
    'cool',
    'nice',
    'great',
    'good',
    'alright',
    'got it',
    'i see',
    'hmm',
    'test',
    'testing',
    'testing testing',
    'yes',
    'no',
  ],
}

const REPLIES = {
  greeting: (scope) =>
    `Hi! Ask me anything about ${scope} and I'll answer from the text, with sources.`,
  thanks: (scope) =>
    `You're welcome. Ask another question about ${scope} whenever you like.`,
  goodbye: (scope) =>
    `Goodbye! Come back any time with more questions about ${scope}.`,
  help: (scope) =>
    `I answer questions about ${scope} using only what the text says, and show the passages I used. Try one of the starters, or ask in your own words.`,
  ack: (scope) =>
    `Got it. Ask a question about ${scope} whenever you're ready.`,
}

// Lower case, letters and spaces only, and "heyyy" read as "hey".
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// Edits (insert, delete, change, or swap two neighbours) needed to turn one string into the
// other; anything past `limit` is reported as limit + 1 without working it out.
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let older = []
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j], older[j - 2] + 1)
    }
    older = previous
    previous = row
  }
  return previous[b.length]
}

// How many slips a phrase of this length forgives. Short ones forgive none: "hi", "ok" and
// "ty" are too close to ordinary words.
const forgiven = (phrase) =>
  phrase.length >= 12 ? 2 : phrase.length >= 5 ? 1 : 0

function kindOf(clean) {
  for (const [kind, phrases] of Object.entries(PHRASES))
    if (phrases.includes(clean)) return kind
  for (const [kind, phrases] of Object.entries(PHRASES))
    for (const phrase of phrases) {
      const limit = forgiven(phrase)
      if (limit > 0 && distance(clean, phrase, limit) <= limit) return kind
    }
  return null
}

// The reply to a message that is only small talk, or null when it should go to the documents.
// `scope` is how to name what is being asked about, such as "this document".
export function smallTalkReply(text, scope) {
  // A digit means a real question ("section 2") or a code, and cannot be small talk.
  if (text.length > MAX_LENGTH || /\d/.test(text)) return null
  const clean = normalise(text)
  if (!clean) return null
  const kind = kindOf(clean)
  return kind ? REPLIES[kind](scope) : null
}
