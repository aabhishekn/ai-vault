import { useId, useState } from 'react'
import { documentTitle } from '../../lib/format'

const LABEL = /\[(\d+)\]/g

// What a person asked: a soft bubble on the right, so a thread reads as a conversation.
export function QuestionBubble({ text }) {
  return (
    <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-[#f3e3d9] px-4 py-2.5 text-[14px] leading-[1.65] wrap-anywhere whitespace-pre-wrap">
      <span className="sr-only">You asked: </span>
      {text}
    </p>
  )
}

// One paragraph of an answer. A label such as [2] that names a real source becomes a button
// that opens that source; any other bracketed number stays as text.
function Paragraph({ text, known, onCite }) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(LABEL)) {
    const number = Number(match[1])
    if (!known.has(number)) continue
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <button
        key={match.index}
        type="button"
        className="mx-px cursor-pointer rounded-[5px] border-0 bg-[#f3e3d9] px-1 py-px align-baseline font-sans text-[11px] font-semibold text-earth hover:bg-[#ead3c4]"
        aria-label={`Show source ${number}`}
        onClick={() => onCite(number)}
      >
        [{number}]
      </button>,
    )
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return (
    <p className="font-serif text-[16px] leading-[1.75] whitespace-pre-wrap">
      {parts}
    </p>
  )
}

function sourceLabel(citation) {
  const title = citation.filename
    ? ` · ${documentTitle(citation.filename)}`
    : ''
  return `[${citation.source_number}]${title} · Page ${citation.page_number}`
}

// A question's answer: the text with clickable source labels, then the sources as compact
// chips that each open the passage the answer was drawn from.
export function AnswerResult({ result }) {
  const idBase = useId()
  const [open, setOpen] = useState(() => new Set())
  const known = new Set(result.citations.map((item) => item.source_number))
  const panelId = (number) => `${idBase}-source-${number}`

  function toggle(number) {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(number)) next.add(number)
      return next
    })
  }

  // A label in the text always opens its source, and brings it into view.
  function cite(number) {
    setOpen((current) => new Set(current).add(number))
    requestAnimationFrame(() =>
      document.getElementById(panelId(number))?.scrollIntoView?.({
        block: 'nearest',
      }),
    )
  }

  const paragraphs = result.answer
    .split(/\n{2,}/)
    .filter((text) => text.trim() !== '')

  return (
    <div className="wrap-anywhere">
      <QuestionBubble text={result.question} />
      {result.insufficient_evidence ? (
        <div className="mt-4 rounded-xl border border-panel-border bg-panel-footer px-4 py-3">
          <h4 className="mb-1 text-[13px] font-semibold">
            Not enough evidence
          </h4>
          <p className="text-[14px] leading-[1.7] text-muted">
            {result.answer}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <h4 className="sr-only">Answer</h4>
          {paragraphs.map((text, index) => (
            <Paragraph key={index} text={text} known={known} onCite={cite} />
          ))}
        </div>
      )}
      {result.citations.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold tracking-[0.04em] text-muted uppercase">
            Sources
          </h4>
          <ol className="flex list-none flex-wrap gap-2">
            {result.citations.map((citation) => (
              <li key={citation.source_number} className="max-w-full">
                <button
                  type="button"
                  className="max-w-full cursor-pointer truncate rounded-full border border-evidence-border bg-surface px-3 py-1.5 text-[12px] font-semibold text-earth hover:border-earth aria-expanded:border-earth aria-expanded:bg-[#f3e3d9]"
                  aria-expanded={open.has(citation.source_number)}
                  aria-controls={panelId(citation.source_number)}
                  onClick={() => toggle(citation.source_number)}
                >
                  {sourceLabel(citation)}
                </button>
              </li>
            ))}
          </ol>
          {result.citations
            .filter((citation) => open.has(citation.source_number))
            .map((citation) => (
              <blockquote
                key={citation.source_number}
                id={panelId(citation.source_number)}
                className="mt-3 rounded-xl border border-evidence-border bg-[#f7f5ee] px-4 py-3 text-[13px] leading-[1.8] whitespace-pre-wrap text-muted"
              >
                <span className="mb-1 block text-[11px] font-semibold text-earth">
                  {sourceLabel(citation)}
                </span>
                {citation.text}
              </blockquote>
            ))}
        </div>
      )}
    </div>
  )
}
