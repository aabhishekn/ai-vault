import { useRef } from 'react'
import { Button } from '../../components/Button'
import { canGenerateSummary } from './summary'
import type { DocumentStatus } from './types'
import { useDocumentSummary } from './useDocumentSummary'
import './DocumentSummary.css'

export function DocumentSummary({
  id,
  documentStatus,
}: {
  id: string
  documentStatus: DocumentStatus
}) {
  const { state, refresh, generate } = useDocumentSummary(id, documentStatus)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = state.status === 'loading' || state.status === 'generating'
  const canGenerate = canGenerateSummary(documentStatus)
  return (
    <section
      className="document-summary"
      aria-labelledby="summary-heading"
      aria-busy={busy}
    >
      <div className="summary-header">
        <h3 ref={heading} tabIndex={-1} id="summary-heading">
          Summary
        </h3>
        <Button
          onClick={() => {
            if (!busy) refresh()
          }}
          aria-disabled={busy}
        >
          {state.status === 'error' ? 'Check saved summary' : 'Refresh summary'}
        </Button>
      </div>
      {state.status === 'loading' && (
        <p className="summary-message" role="status">
          Loading saved summary…
        </p>
      )}
      {state.status === 'empty' && (
        <div>
          <p className="summary-message" role="status">
            No summary has been saved for this document yet.
          </p>
          {canGenerate ? (
            <p
              className="summary-message summary-generation-note"
              id="summary-generation-note"
            >
              Generate a short summary using AI. Document text is sent to your
              configured AI provider and API charges may apply.
            </p>
          ) : (
            <p className="summary-message summary-generation-note">
              A summary needs extracted document text. Refresh document details
              after processing finishes.
            </p>
          )}
        </div>
      )}
      {(state.status === 'empty' || state.status === 'generating') && (
        <Button
          className="summary-generate"
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
        <p className="summary-message summary-generation-note" role="status">
          Generating your summary. Keep this view open; this may take a moment.
        </p>
      )}
      {state.status === 'error' && (
        <p className="summary-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="summary-content">{state.summary.summary}</p>
      )}
    </section>
  )
}
