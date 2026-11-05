import { useId, useMemo, useState } from 'react'
import { documentTitle, readableText } from '../../lib/format'
import {
  groupSources,
  parseAnswer,
  sentencesCiting,
  sourceName,
  splitCitations,
} from './answerText'
import { focusPassage } from './passage'

// What a person asked: a soft bubble on the right, so a thread reads as a conversation.
export function QuestionBubble({ text }) {
  return (
    <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-[#f3e3d9] px-4 py-2.5 text-[14px] leading-[1.65] wrap-anywhere whitespace-pre-wrap">
      <span className="sr-only">You asked: </span>
      {text}
    </p>
  )
}

// Source labels that sit together, such as [1][8][9], are one capsule whose parts each open
// their own source.
function Citations({ numbers, onCite }) {
  return (
    <span className="mx-0.5 inline-flex rounded-md bg-[#f3e3d9] align-[0.12em] whitespace-nowrap">
      {numbers.map((number) => (
        <button
          key={number}
          type="button"
          className="cursor-pointer border-0 bg-transparent px-1.5 py-[3px] font-sans text-[10.5px] leading-none font-semibold text-earth not-first:border-l not-first:border-[#e8cdbd] first:rounded-l-md last:rounded-r-md hover:bg-[#ead3c4]"
          aria-label={`Show source ${number}`}
          onClick={() => onCite(number)}
        >
          [{number}]
        </button>
      ))}
    </span>
  )
}

// Text with its source labels turned into clickable capsules. A label that names no real
// source stays as text.
function Text({ text, known, onCite }) {
  return splitCitations(text, known).map((part, index) =>
    part.type === 'cite' ? (
      <Citations key={index} numbers={part.numbers} onCite={onCite} />
    ) : (
      part.value
    ),
  )
}

// One block of an answer: a paragraph, or a list of short points.
function Block({ block, known, onCite }) {
  if (block.type === 'paragraph')
    return (
      <p className="font-serif text-[16px] leading-[1.75] whitespace-pre-wrap">
        <Text text={block.text} known={known} onCite={onCite} />
      </p>
    )
  const List = block.type === 'numbers' ? 'ol' : 'ul'
  return (
    <List
      className={`grid gap-2 pl-6 font-serif text-[16px] leading-[1.7] marker:font-sans marker:text-earth ${block.type === 'numbers' ? 'list-decimal marker:text-[14px] marker:font-semibold' : 'list-disc'}`}
    >
      {block.items.map((item, index) => (
        <li key={index} className="pl-1">
          <Text text={item} known={known} onCite={onCite} />
        </li>
      ))}
    </List>
  )
}

// The short label on a source chip; the document's name is the heading above its chips.
function chipLabel(citation) {
  return `[${citation.source_number}] · Page ${citation.page_number}`
}

// The passage a source was drawn from. When the part that backs the answer can be found it
// is marked and the rest is tucked away behind "Show full passage"; otherwise the passage
// is shown whole.
function Passage({ text, query }) {
  const [showAll, setShowAll] = useState(false)
  const shown = readableText(text)
  const view = useMemo(() => focusPassage(shown, query), [shown, query])
  if (!view) return shown
  return (
    <>
      {(showAll ? view.full : view.excerpt).map((piece, index) =>
        piece.gap ? (
          <span key={index} className="text-muted">
            …{' '}
          </span>
        ) : piece.hit ? (
          <mark key={index} className="rounded-[3px] bg-[#f6dcc9] text-ink">
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )}
      {view.trimmed && (
        <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[12px]">
          <span>
            {showAll
              ? 'Showing the whole passage; the match is marked.'
              : 'Showing the part that matches the answer.'}
          </span>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-earth hover:underline"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show only the match' : 'Show full passage'}
          </button>
        </span>
      )}
    </>
  )
}

function sourceLabel(citation) {
  const name = sourceName(citation, documentTitle)
  const title = name ? ` · ${name}` : ''
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

  const blocks = parseAnswer(result.answer)

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
          {blocks.map((block, index) => (
            <Block key={index} block={block} known={known} onCite={cite} />
          ))}
        </div>
      )}
      {result.citations.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold tracking-[0.04em] text-muted uppercase">
            Sources
          </h4>
          <div className="grid gap-3">
            {groupSources(result.citations).map((group) => (
              <div key={group.key} className="grid gap-1.5">
                {sourceName(group.citation, documentTitle) && (
                  <p
                    className="truncate text-[13px] font-semibold"
                    title={group.citation.filename || undefined}
                  >
                    {sourceName(group.citation, documentTitle)}
                  </p>
                )}
                <ol className="flex list-none flex-wrap gap-2">
                  {group.citations.map((citation) => (
                    <li key={citation.source_number} className="max-w-full">
                      <button
                        type="button"
                        className="max-w-full cursor-pointer truncate rounded-full border border-evidence-border bg-surface px-3 py-1.5 text-[12px] font-semibold text-earth hover:border-earth aria-expanded:border-earth aria-expanded:bg-[#f3e3d9]"
                        aria-expanded={open.has(citation.source_number)}
                        aria-controls={panelId(citation.source_number)}
                        onClick={() => toggle(citation.source_number)}
                      >
                        {chipLabel(citation)}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
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
                <Passage
                  text={citation.text}
                  query={
                    sentencesCiting(result.answer, citation.source_number) ||
                    result.question
                  }
                />
              </blockquote>
            ))}
        </div>
      )}
    </div>
  )
}
