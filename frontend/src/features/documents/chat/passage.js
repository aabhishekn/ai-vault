// Finds the part of a retrieved passage that backs an answer, so the source card can show
// just that part. Matching is by shared words, which is a heuristic: when nothing matches,
// or the passage is short, the whole passage is shown as it is.

const MIN_WORDS = 4 // a sentence or line this short joins the next one ("Ok?", "Fig. 3")
const MAX_WORDS = 24 // a stretch with no sentence end (a flattened diagram) is cut here
const SHORT_PASSAGE = 4 // units; a passage this short is never trimmed
const CONTEXT = 1 // units kept on each side of a match
const BEST_SHARE = 0.7 // a unit this close to the best score counts as a match
const MAX_MATCHES = 3

const STOP_WORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has have been from ' +
    'that this with they them then than there their these those what when where which who ' +
    'whom whose will would could should into onto over under about after before also each ' +
    'such only some more most other its it is as at be by do if in no of on or so to up we ' +
    'an a how why while were does did being both between during'
  ).split(' '),
)

// A rough stem, enough to match "released" with "release" and "tickets" with "ticket".
function stem(word) {
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 3) continue
    if (suffix === 's' && word.endsWith('ss')) return word
    return word.slice(0, -suffix.length)
  }
  return word
}

export function terms(text) {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(
    words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)).map(stem),
  )
}

// Cuts a passage into short units (sentences, lines, bullets, or runs of words) that join
// back into exactly the original text.
export function splitPassage(text) {
  const pieces = text.match(/\S+\s*/g)
  if (!pieces) return [text]
  pieces[0] = text.match(/^\s*/)[0] + pieces[0]
  const units = []
  let current = ''
  let words = 0
  for (const piece of pieces) {
    if (current && piece.trimStart().startsWith('•')) {
      units.push(current)
      current = ''
      words = 0
    }
    current += piece
    words += 1
    const ends = /[.!?]["')\]]*\s*$/.test(piece) || piece.includes('\n')
    if ((ends && words >= MIN_WORDS) || words >= MAX_WORDS) {
      units.push(current)
      current = ''
      words = 0
    }
  }
  if (current) units.push(current)
  return units
}

// How well each unit matches the query: words that few units share count for more.
function scores(units, query) {
  const wanted = terms(query)
  const unitTerms = units.map((unit) => terms(unit))
  const common = new Map()
  for (const set of unitTerms)
    for (const word of set) common.set(word, (common.get(word) ?? 0) + 1)
  return unitTerms.map((set) => {
    let total = 0
    for (const word of wanted)
      if (set.has(word)) total += Math.log(1 + units.length / common.get(word))
    return total
  })
}

// `full` is the passage as marked-up pieces; `excerpt` is only the matching part with a gap
// piece wherever text is left out; `trimmed` says whether they differ. Null means there is
// nothing to mark, so the passage is shown plain.
export function focusPassage(text, query) {
  const units = splitPassage(text)
  if (units.length < 2) return null
  const score = scores(units, query)
  const best = Math.max(...score)
  if (!(best > 0)) return null
  const hits = score
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value >= best * BEST_SHARE)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_MATCHES)
    .map((item) => item.index)
  const marked = hits.length < units.length ? new Set(hits) : new Set()
  const full = units.map((value, index) => ({
    text: value,
    hit: marked.has(index),
  }))
  const shown = new Set()
  for (const index of hits)
    for (let near = index - CONTEXT; near <= index + CONTEXT; near += 1)
      if (near >= 0 && near < units.length) shown.add(near)
  const trimmed = units.length > SHORT_PASSAGE && shown.size < units.length - 1
  if (!trimmed) return { full, excerpt: full, trimmed: false }
  const excerpt = []
  let previous = -1
  full.forEach((piece, index) => {
    if (!shown.has(index)) return
    if (index > previous + 1) excerpt.push({ gap: true })
    excerpt.push(piece)
    previous = index
  })
  if (previous < units.length - 1) excerpt.push({ gap: true })
  return { full, excerpt, trimmed: true }
}
