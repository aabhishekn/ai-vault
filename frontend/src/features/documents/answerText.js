const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const LABEL = /\[(\d+)\]/g

// An answer as readable blocks: paragraphs, and lists where lines start with "- " or "1.".
// Blank lines separate blocks; a run of list lines becomes one list.
export function parseAnswer(answer) {
  const blocks = []
  for (const chunk of answer.split(/\n{2,}/)) {
    let paragraph = []
    let list = null
    const endParagraph = () => {
      const text = paragraph.join('\n').trim()
      if (text) blocks.push({ type: 'paragraph', text })
      paragraph = []
    }
    const endList = () => {
      if (list) blocks.push(list)
      list = null
    }
    for (const line of chunk.split('\n')) {
      const bullet = BULLET.exec(line)
      const numbered = bullet ? null : NUMBERED.exec(line)
      const match = bullet ?? numbered
      if (!match) {
        endList()
        paragraph.push(line)
        continue
      }
      const type = bullet ? 'bullets' : 'numbers'
      if (list?.type !== type) {
        endList()
        endParagraph()
        list = { type, items: [] }
      }
      list.items.push(match[1].trim())
    }
    endList()
    endParagraph()
  }
  return blocks
}

// Splits text around its source labels. Labels that name a real source, and sit next to each
// other ("[1][2]", "[1], [2]"), become one `cite` segment; anything else stays text.
export function splitCitations(text, known) {
  const segments = []
  let last = 0
  let run = null
  const endRun = () => {
    if (run) segments.push({ type: 'cite', numbers: run })
    run = null
  }
  for (const match of text.matchAll(LABEL)) {
    const number = Number(match[1])
    if (!known.has(number)) continue
    if (run && /^[\s,]*$/.test(text.slice(last, match.index))) {
      if (!run.includes(number)) run.push(number)
    } else {
      endRun()
      if (match.index > last)
        segments.push({ type: 'text', value: text.slice(last, match.index) })
      run = [number]
    }
    last = match.index + match[0].length
  }
  endRun()
  if (last < text.length)
    segments.push({ type: 'text', value: text.slice(last) })
  return segments
}

// What a source's document is called: its title when it has one, otherwise the file name.
export function sourceName(citation, tidy) {
  return citation.title || (citation.filename ? tidy(citation.filename) : '')
}

// Sources grouped by the document they came from, in the order each document first appears.
// A document is told apart by its ID, or by its file name when there is no ID.
export function groupSources(citations) {
  const groups = []
  for (const citation of citations) {
    const key = citation.document_id ?? citation.filename ?? ''
    let group = groups.find((item) => item.key === key)
    if (!group) {
      group = { key, citation, citations: [] }
      groups.push(group)
    }
    group.citations.push(citation)
  }
  return groups
}

// The sentences or list lines of an answer that cite a source, joined and without their
// labels. A label that follows the full stop still belongs to the sentence before it, and
// sentences with no label of their own count for the next labelled one: a model often
// cites once at the end of a few sentences.
export function sentencesCiting(answer, number) {
  const label = `[${number}]`
  const found = []
  for (const block of parseAnswer(answer)) {
    const paragraph = block.type === 'paragraph'
    const parts = paragraph
      ? block.text.split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?!\[\d)|\n/)
      : block.items
    let lead = []
    for (const part of parts) {
      if (!/\[\d+\]/.test(part)) {
        if (paragraph) lead.push(part)
        continue
      }
      if (part.includes(label)) found.push(...lead, part)
      lead = []
    }
  }
  return found
    .map((part) => part.replace(/\s*\[\d+\]/g, ''))
    .join(' ')
    .trim()
}
