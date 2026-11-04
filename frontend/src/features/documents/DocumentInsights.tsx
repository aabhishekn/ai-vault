import { Button } from '../../components/Button'
import { useResource } from '../../hooks/useResource'
import { getSavedInsights } from './insights'

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
      className="border-t border-rule py-6"
      aria-labelledby="insights-heading"
      aria-busy={loading}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 [&_h3]:text-[15px] [&_h3]:font-semibold">
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
        <p className="text-[13px] leading-[1.9] text-muted" role="status">
          Loading saved insights…
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-[13px] leading-[1.9] text-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && !saved && (
        <p className="text-[13px] leading-[1.9] text-muted" role="status">
          No insights have been saved for this document yet.
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
