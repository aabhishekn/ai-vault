import { useRef } from 'react'
import { Button } from '../../components/Button'
import { CustomSummary } from './CustomSummary'
import { canGenerateSummary } from './summary'

import { useDocumentSummary } from './useDocumentSummary'

export function DocumentSummary({ id, documentStatus }) {
  const { state, refresh, generate } = useDocumentSummary(id, documentStatus)
  const heading = useRef(null)
  const busy = state.status === 'loading' || state.status === 'generating'
  const canGenerate = canGenerateSummary(documentStatus)
  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="summary-heading"
      aria-busy={busy}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 [&_h3]:text-[15px] [&_h3]:font-semibold">
        <h3 ref={heading} tabIndex={-1} id="summary-heading">
          Summary
        </h3>
        {state.status === 'error' && (
          <Button
            onClick={() => {
              if (!busy) refresh()
            }}
          >
            Check saved summary
          </Button>
        )}
      </div>
      {state.status === 'loading' && (
        <p
          className="text-[13px] leading-[1.9] wrap-anywhere text-muted"
          role="status"
        >
          Loading saved summary…
        </p>
      )}
      {state.status === 'empty' && (
        <div>
          <p
            className="text-[13px] leading-[1.9] wrap-anywhere text-muted"
            role="status"
          >
            No summary has been saved for this document yet.
          </p>
          {canGenerate ? (
            <p
              className="mt-3 text-[13px] leading-[1.9] wrap-anywhere text-muted"
              id="summary-generation-note"
            >
              Generate a short summary using AI. Document text is sent to your
              configured AI provider and API charges may apply.
            </p>
          ) : (
            <p className="mt-3 text-[13px] leading-[1.9] wrap-anywhere text-muted">
              A summary needs extracted document text. Try again once processing
              finishes.
            </p>
          )}
        </div>
      )}
      {(state.status === 'empty' || state.status === 'generating') && (
        <Button
          className="mt-4"
          aria-disabled={!canGenerate || busy}
          aria-describedby={
            state.status === 'empty' && canGenerate
              ? 'summary-generation-note'
              : undefined
          }
          onClick={async () => {
            if (!canGenerate || busy) return
            await generate()
            heading.current?.focus()
          }}
        >
          {state.status === 'generating' ? 'Generating…' : 'Generate summary'}
        </Button>
      )}
      {state.status === 'generating' && (
        <p
          className="mt-3 text-[13px] leading-[1.9] wrap-anywhere text-muted"
          role="status"
        >
          Generating your summary. Keep this view open; this may take a moment.
        </p>
      )}
      {state.status === 'error' && (
        <p
          className="text-[13px] leading-[1.9] wrap-anywhere text-error"
          role="alert"
        >
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="font-serif text-base leading-[1.75] wrap-anywhere whitespace-pre-wrap">
          {state.data.summary}
        </p>
      )}
      {canGenerate && <CustomSummary id={id} />}
    </section>
  )
}
