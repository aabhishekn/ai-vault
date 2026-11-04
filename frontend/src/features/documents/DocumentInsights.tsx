import { Button } from '../../components/Button'
import { useResource } from '../../hooks/useResource'
import { getSavedInsights } from './insights'
import './DocumentInsights.css'

export function DocumentInsights({ id }: { id: string }) {
  const { state, refresh } = useResource(
    id,
    getSavedInsights,
    'We couldn’t load the saved insights. Check your connection and try again.',
  )
  const loading = state.status === 'loading'
  const saved = state.status === 'success' ? state.data : null
  return (
    <section
      className="document-insights"
      aria-labelledby="insights-heading"
      aria-busy={loading}
    >
      <div className="insights-header">
        <h3 id="insights-heading">Saved insights</h3>
        <Button
          onClick={() => {
            if (!loading) refresh()
          }}
          aria-disabled={loading}
        >
          {state.status === 'error' ? 'Retry insights' : 'Refresh insights'}
        </Button>
      </div>
      {loading && (
        <p className="insights-message" role="status">
          Loading saved insights…
        </p>
      )}
      {state.status === 'error' && (
        <p className="insights-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && !saved && (
        <p className="insights-message" role="status">
          No insights have been saved for this document yet.
        </p>
      )}
      {saved && saved.insights.length === 0 && (
        <p className="insights-message" role="status">
          The saved result contains no insights.
        </p>
      )}
      {saved && saved.insights.length > 0 && (
        <ol className="insights-list">
          {saved.insights.map((insight, index) => (
            <li key={index} className="insight-card">
              <p className="insight-text">{insight.text}</p>
              <p className="insight-page">Page {insight.page_number}</p>
              <blockquote className="insight-evidence">
                <p>{insight.evidence}</p>
              </blockquote>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
