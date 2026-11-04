import { Button } from '../../components/Button'
import { DocumentRow } from './DocumentRow'
import type { useDocuments } from './useDocuments'
import './DocumentList.css'

export function DocumentList({
  state,
  refresh,
  goToPage,
  onSelect,
}: ReturnType<typeof useDocuments> & { onSelect: (id: string) => void }) {
  const loading = state.status === 'loading'
  const page = state.status === 'success' ? state.page : null

  return (
    <section
      className="document-list"
      aria-labelledby="documents-heading"
      aria-busy={loading}
    >
      <div className="document-list-header">
        <div className="document-list-title">
          <h2 id="documents-heading">All documents</h2>
          {page && (
            <span
              className="document-count"
              aria-label={`${page.total} documents`}
            >
              {page.total}
            </span>
          )}
        </div>
        <Button onClick={refresh} disabled={loading}>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M15.5 7a6 6 0 1 0 .3 5M15.5 3.5V7H12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {loading && (
        <div className="document-list-message" role="status">
          <span className="document-loading-mark" aria-hidden="true" />
          <h3>Gathering your documents…</h3>
          <p>This will only take a moment.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div
          className="document-list-message document-list-message--error"
          role="alert"
        >
          <h3>We couldn’t load your documents.</h3>
          <p>{state.message}</p>
          <Button onClick={refresh}>Try again</Button>
        </div>
      )}

      {page && page.items.length === 0 && (
        <div className="document-list-message" role="status">
          <span className="document-empty-mark" aria-hidden="true">
            +
          </span>
          <h3>A little space for your next idea.</h3>
          <p>No documents yet. Your uploaded PDFs will appear here.</p>
        </div>
      )}

      {page && page.items.length > 0 && (
        <>
          <ul className="document-rows" aria-label="Uploaded documents">
            {page.items.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onSelect={onSelect}
              />
            ))}
          </ul>
          <div className="document-list-footer">
            <p>
              Showing{' '}
              <strong>
                {page.offset + 1}–{page.offset + page.items.length}
              </strong>{' '}
              of {page.total}
            </p>
            <nav aria-label="Document pages">
              <Button
                onClick={() => goToPage(Math.max(0, page.offset - page.limit))}
                disabled={page.offset === 0}
              >
                Previous
              </Button>
              <Button
                onClick={() => goToPage(page.offset + page.limit)}
                disabled={page.offset + page.items.length >= page.total}
              >
                Next
              </Button>
            </nav>
          </div>
        </>
      )}
    </section>
  )
}
