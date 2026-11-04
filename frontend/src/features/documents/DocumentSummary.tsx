import { Button } from '../../components/Button'
import { useSavedSummary } from './useSavedSummary'
import './DocumentSummary.css'

export function DocumentSummary({ id }: { id: string }) {
  const { state, refresh } = useSavedSummary(id)
  const loading = state.status === 'loading'
  return (
    <section
      className="document-summary"
      aria-labelledby="summary-heading"
      aria-busy={loading}
    >
      <div className="summary-header">
        <h3 id="summary-heading">Saved summary</h3>
        <Button
          onClick={() => {
            if (!loading) refresh()
          }}
          aria-disabled={loading}
        >
          {state.status === 'error' ? 'Retry summary' : 'Refresh summary'}
        </Button>
      </div>
      {loading && (
        <p className="summary-message" role="status">
          Loading saved summary…
        </p>
      )}
      {state.status === 'empty' && (
        <p className="summary-message" role="status">
          No summary has been saved for this document yet.
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
