// Messages that are only a greeting, thanks, goodbye or a "what can you do?". The documents
// have nothing to say to these, so sending one would cost a model call just to be told
// "not enough evidence". They are answered on the spot instead, and never sent.
const MAX_LENGTH = 40

const KINDS = [
  [
    'greeting',
    /^(hi|hello|hey|hiya|howdy|yo|sup|hola|namaste|greetings)( there| all| everyone| team)?( how are you( doing| today)?)?$|^good (morning|afternoon|evening)$|^how are you( doing| today)?$/,
  ],
  [
    'thanks',
    /^(ok(ay)? |great |cool )?(thanks|thank you|thank u|thx|ty|cheers|many thanks|much appreciated)( a lot| so much| very much| again)?$/,
  ],
  [
    'goodbye',
    /^(ok(ay)? )?(bye|goodbye|good night|see you|see ya|cya|take care|farewell)( bye| now| later| soon| then)?$/,
  ],
  [
    'help',
    /^(help|what can you do|what do you do|who are you|how does this work)$/,
  ],
]

const REPLIES = {
  greeting: (scope) =>
    `Hi! Ask me anything about ${scope} and I'll answer from the text, with sources.`,
  thanks: (scope) =>
    `You're welcome. Ask another question about ${scope} whenever you like.`,
  goodbye: (scope) =>
    `Goodbye! Come back any time with more questions about ${scope}.`,
  help: (scope) =>
    `I answer questions about ${scope} using only what the text says, and show the passages I used. Try one of the starters, or ask in your own words.`,
}

// Lower case, letters and spaces only, and "heyyy" read as "hey".
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// The reply to a message that is only small talk, or null when it should go to the documents.
// `scope` is how to name what is being asked about, such as "this document".
export function smallTalkReply(text, scope) {
  if (text.length > MAX_LENGTH) return null
  const clean = normalise(text)
  const kind = KINDS.find(([, pattern]) => pattern.test(clean))?.[0]
  return kind ? REPLIES[kind](scope) : null
}
