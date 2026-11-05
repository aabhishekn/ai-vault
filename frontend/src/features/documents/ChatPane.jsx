import { Button } from '../../components/Button'
import { ChatThread } from './ChatThread'
import { MAX_COMPARED } from './comparison'
import { MAX_SCOPE } from './scope'

const MULTI_STARTERS = [
  'Give me a one-sentence summary of each document.',
  'What do these documents have in common?',
  'Which dates, deadlines or amounts are mentioned?',
]

function scopeLabel(scope) {
  if (scope.kind === 'all') return `all ${scope.items.length} documents`
  if (scope.kind === 'picked') return `these ${scope.items.length} documents`
  return 'this document'
}

function Chip({ children, onRemove, label }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-[7px] bg-[#f3e3d9] py-1 pr-1 pl-2.5 text-[12px] font-semibold text-[#3d3d3a]">
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-[#6b6a64] hover:bg-[#ead3c4] hover:text-ink"
          aria-label={label}
          onClick={onRemove}
        >
          <svg
            viewBox="0 0 20 20"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="pr-1.5" />
      )}
    </span>
  )
}

// The one place to ask questions. What it asks about follows the ticked documents, or every
// document that is ready when none is ticked; the chips always say which.
export function ChatPane({
  scope,
  library,
  className = '',
  onUntick,
  onUseAll,
  onCompare,
  onShowDocuments,
}) {
  const picked = scope.items.length > 0 && !scope.implicit
  const canCompare =
    scope.items.length >= 2 && scope.items.length <= MAX_COMPARED

  return (
    <section
      className={`min-h-0 min-w-0 flex-1 flex-col bg-surface ${className}`}
      aria-label="Chat"
    >
      {scope.kind !== 'none' && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-6 py-3 max-[600px]:px-4">
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            role="group"
            aria-label="Asking"
          >
            <span className="text-[12px] text-muted">Asking</span>
            {scope.kind === 'all' ? (
              <Chip>All documents ({scope.items.length})</Chip>
            ) : (
              scope.items.map((item) => (
                <Chip
                  key={item.id}
                  label={`Stop asking about ${item.name}`}
                  onRemove={picked ? () => onUntick(item.id) : undefined}
                >
                  {item.name}
                </Chip>
              ))
            )}
            {scope.truncated && (
              <span className="text-[11px] text-muted">
                newest {MAX_SCOPE} of {scope.total} · tick documents to choose
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {picked && <Button onClick={onUseAll}>Use all documents</Button>}
            {canCompare && <Button onClick={onCompare}>Compare</Button>}
          </div>
        </div>
      )}

      {scope.kind === 'none' ? (
        <div className="m-auto max-w-[420px] px-6 py-10 text-center">
          <p className="font-serif text-[clamp(30px,4vw,40px)] leading-[1.1] tracking-[-0.03em]">
            Ask your documents.
          </p>
          {!library.loaded ? (
            <p
              className="mt-3 text-[14px] leading-[1.7] text-muted"
              role="status"
            >
              Loading your documents…
            </p>
          ) : library.total === 0 ? (
            <p className="mt-3 text-[14px] leading-[1.7] text-muted">
              Upload a PDF or an image to start. Once it is processed you can
              ask questions and get answers that cite the page they came from.
            </p>
          ) : (
            <p className="mt-3 text-[14px] leading-[1.7] text-muted">
              {library.waiting > 0
                ? `${library.waiting} ${library.waiting === 1 ? 'document is' : 'documents are'} still being processed. You can ask questions as soon as one is Search ready.`
                : 'None of your documents can be asked about yet. Open one and use Process again if it failed.'}
            </p>
          )}
          <Button className="mt-5 lg:hidden" onClick={onShowDocuments}>
            Show documents
          </Button>
        </div>
      ) : (
        <ChatThread
          key={scope.key}
          id={scope.kind === 'single' ? scope.ids[0] : null}
          documentIds={scope.ids}
          placeholder={`Ask ${scopeLabel(scope)}…`}
          starters={MULTI_STARTERS}
        />
      )}
    </section>
  )
}
