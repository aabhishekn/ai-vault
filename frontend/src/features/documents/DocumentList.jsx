import { Button } from '../../components/Button'
import { DocumentFilters } from './DocumentFilters'
import { DocumentRow } from './DocumentRow'
import { useTagsOverview } from './useTagsOverview'

export function DocumentList({
  state,
  refresh,
  goToPage,
  filter,
  setFilter,
  onSelect,
  chosen,
  onChoose,
  live = false,
}) {
  const loading = state.status === 'loading'
  const page = state.status === 'success' ? state.page : null
  const overview = useTagsOverview(page)

  return (
    <section
      className="overflow-hidden rounded-[18px] border border-panel-border bg-surface shadow-panel"
      aria-labelledby="documents-heading"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule px-[26px] py-[22px] max-[600px]:p-[18px]">
        <div className="flex items-center gap-2.5 [&_h2]:text-sm [&_h2]:font-semibold">
          <h2 id="documents-heading">All documents</h2>
          {live && (
            <span
              className="rounded-[7px] bg-[#e4ead9] px-1.5 py-0.5 text-[10px] font-semibold text-[#3e4a37]"
              title="Status changes appear here as they happen"
            >
              ● Live
            </span>
          )}
          {page && (
            <span
              className="grid h-6 min-w-6 place-items-center rounded-[7px] bg-[#f0f1e9] px-[7px] text-[11px] text-[#58634f]"
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

      <DocumentFilters
        overview={overview}
        filter={filter}
        onChange={setFilter}
      />

      {loading && (
        <div
          className="px-[26px] py-[54px] text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="status"
        >
          <span
            className="inline-block size-[22px] animate-spin rounded-full border-2 border-[#e1e5d8] border-t-[#71816a] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <h3>Gathering your documents…</h3>
          <p>This will only take a moment.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div
          className="bg-[#fffaf7] px-[26px] py-[54px] text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="alert"
        >
          <h3>We couldn’t load your documents.</h3>
          <p>{state.message}</p>
          <Button className="mt-5" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}

      {page && page.items.length === 0 && (
        <div
          className="px-[26px] py-[54px] text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="status"
        >
          <span
            className="inline-grid size-10 place-items-center rounded-full bg-[#f0f2e8] text-[26px] font-normal text-[#738364]"
            aria-hidden="true"
          >
            +
          </span>
          {filter.category || filter.tag ? (
            <>
              <h3>Nothing matches this filter.</h3>
              <p>Try a different category or tag.</p>
            </>
          ) : (
            <>
              <h3>Your vault is empty.</h3>
              <p>No documents yet. Your uploaded PDFs will appear here.</p>
            </>
          )}
        </div>
      )}

      {page && page.items.length > 0 && (
        <>
          <ul className="list-none" aria-label="Uploaded documents">
            {page.items.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onSelect={onSelect}
                chosen={chosen?.has(document.id)}
                onChoose={onChoose}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-panel-footer px-[26px] py-4 max-[600px]:p-[18px] [&_nav]:flex [&_nav]:gap-2 [&_p]:text-[11px] [&_p]:text-muted [&_strong]:font-[550] [&_strong]:text-[#3e4a37]">
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
