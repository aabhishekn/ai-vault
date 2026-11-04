import { useRef } from 'react'
import { Button } from '../../components/Button'
import { canGenerateInsights } from './insights'

import { useDocumentInsights } from './useDocumentInsights'

export function DocumentInsights({ id, documentStatus }) {
  const { state, refresh, generate } = useDocumentInsights(id, documentStatus)
  const heading = useRef(null)
  const busy = state.status === 'loading' || state.status === 'generating'
  const canGenerate = canGenerateInsights(documentStatus)
  const saved = state.status === 'success' ? state.data : null
  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="insights-heading"
      aria-busy={busy}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 [&_h3]:text-[15px] [&_h3]:font-semibold">
        <h3 ref={heading} tabIndex={-1} id="insights-heading">
          Insights
        </h3>
        <Button
          onClick={() => {
            if (!busy) refresh()
          }}
          aria-disabled={busy}
        >
          {state.status === 'error'
            ? 'Check saved insights'
            : 'Refresh insights'}
        </Button>
      </div>
      {state.status === 'loading' && (
        <p className="text-[13px] leading-[1.9] text-muted" role="status">
          Loading saved insights…
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-[13px] leading-[1.9] text-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'empty' && (
        <div>
          <p className="text-[13px] leading-[1.9] text-muted" role="status">
            No insights have been saved for this document yet.
          </p>
          <p
            className="mt-3 text-[13px] leading-[1.9] text-muted"
            id="insights-generation-note"
          >
            {canGenerate
              ? 'Generate insights with page references using AI. Document text is sent to your configured AI provider and API charges may apply.'
              : 'Insights need extracted document text. Refresh document details after processing finishes.'}
          </p>
        </div>
      )}
      {(state.status === 'empty' || state.status === 'generating') && (
        <Button
          className="mt-4"
          aria-disabled={!canGenerate || busy}
          aria-describedby={
            state.status === 'empty' ? 'insights-generation-note' : undefined
          }
          onClick={async () => {
            if (!canGenerate || busy) return
            await generate()
            heading.current?.focus()
          }}
        >
          {state.status === 'generating' ? 'Generating…' : 'Generate insights'}
        </Button>
      )}
      {state.status === 'generating' && (
        <p className="mt-3 text-[13px] leading-[1.9] text-muted" role="status">
          Generating your insights. Keep this view open; this may take a moment.
        </p>
      )}
      {saved && saved.insights.length === 0 && (
        <p className="text-[13px] leading-[1.9] text-muted" role="status">
          The saved result contains no insights.
        </p>
      )}
      {saved && saved.insights.length > 0 && (
        <ol className="grid list-none gap-3.5">
          {saved.insights.map((insight, index) => (
            <li
              key={index}
              className="rounded-[10px] border border-evidence-border bg-[#f7f8f1] p-[18px] wrap-anywhere"
            >
              <p className="text-[13px] leading-[1.9] whitespace-pre-wrap">
                {insight.text}
              </p>
              <p className="mt-3.5 mb-2.5 text-[11px] font-semibold text-success">
                Page {insight.page_number}
              </p>
              <blockquote className="border-l-2 border-[#bdcbb0] pl-3 [&_p]:text-xs [&_p]:leading-[1.8] [&_p]:whitespace-pre-wrap [&_p]:text-muted">
                <p>{insight.evidence}</p>
              </blockquote>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
