import { Button } from '../../components/Button'
import { useState } from 'react'
import { DocumentFilters } from './DocumentFilters'
import { hasFilterChoices } from './filters'
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
}) {
  const loading = state.status === 'loading'
  const page = state.status === 'success' ? state.page : null
  const overview = useTagsOverview(page)
  const [showFilters, setShowFilters] = useState(false)
  const activeFilters =
    Number(Boolean(filter.category)) + Number(Boolean(filter.tag))

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-surface"
      aria-labelledby="documents-heading"
      aria-busy={loading}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-rule px-4 py-3">
        <div className="flex items-center gap-2.5 [&_h2]:text-sm [&_h2]:font-semibold">
          <h2 id="documents-heading">Documents</h2>
          {page && (
            <span
              className="grid h-6 min-w-6 shrink-0 place-items-center rounded-[7px] bg-[#f0eee6] px-[7px] text-[11px] text-[#5f5e57]"
              aria-label={`${page.total} documents`}
            >
              {page.total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFilterChoices(overview, filter) && (
            <Button
              onClick={() => setShowFilters((previous) => !previous)}
              aria-expanded={showFilters}
            >
              Filter{activeFilters > 0 ? ` · ${activeFilters}` : ''}
            </Button>
          )}
          <Button
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh the list"
            title="Refresh the list"
          >
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
          </Button>
        </div>
      </div>

      {showFilters && hasFilterChoices(overview, filter) && (
        <DocumentFilters
          overview={overview}
          filter={filter}
          onChange={setFilter}
        />
      )}

      {loading && (
        <div
          className="px-6 py-12 text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="status"
        >
          <span
            className="inline-block size-[22px] animate-spin rounded-full border-2 border-[#e6e2d6] border-t-[#7f7d75] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <h3>Gathering your documents…</h3>
          <p>This will only take a moment.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div
          className="bg-[#fffaf7] px-6 py-12 text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="alert"
        >
          <h3>We couldn’t load your documents.</h3>
          <p>{state.message}</p>
          <Button className="mt-5" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}

      {page && page.items.length === 0 && page.total > 0 && (
        <p
          className="px-6 py-12 text-center text-[13px] text-muted"
          role="status"
        >
          Updating your list…
        </p>
      )}

      {page && page.items.length === 0 && page.total === 0 && (
        <div
          className="px-6 py-12 text-center [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-[550] [&_h3]:tracking-[-0.3px] [&_p]:mx-auto [&_p]:max-w-[370px] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          role="status"
        >
          <span
            className="inline-grid size-10 place-items-center rounded-full bg-[#f0eee6] text-[26px] font-normal text-[#7f7d75]"
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
          <ul
            className="min-h-0 flex-1 list-none overflow-y-auto"
            aria-label="Uploaded documents"
          >
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
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule bg-panel-footer px-4 py-3 [&_nav]:flex [&_nav]:gap-2 [&_p]:text-[11px] [&_p]:text-muted [&_strong]:font-[550] [&_strong]:text-[#3d3d3a]">
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
