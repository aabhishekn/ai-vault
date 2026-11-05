import {
  displayTitle,
  formatFileSize,
  formatUploadDate,
} from '../../../lib/format'
import { canAskDocument } from '../status'
import { DocumentStatusBadge } from '../DocumentStatusBadge'

export function DocumentRow({ document, onSelect, chosen = false, onChoose }) {
  const title = displayTitle(document)
  // An upload still on its way: shown at once, but there is nothing to open yet.
  const pending = document.pending === true
  return (
    <li
      className={`grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 not-first:border-t not-first:border-rule ${chosen ? 'bg-[#fbf3ec]' : ''} ${pending ? 'animate-pulse motion-reduce:animate-none' : ''}`}
      aria-busy={pending}
    >
      {onChoose && canAskDocument(document.status) ? (
        <input
          type="checkbox"
          className="mt-0.5 size-[18px] cursor-pointer"
          checked={chosen}
          onChange={() => onChoose(document)}
          aria-label={`Ask about ${title}`}
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="min-w-0 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:leading-snug [&_h3]:font-semibold [&_h3]:wrap-anywhere [&_p]:flex [&_p]:flex-wrap [&_p]:gap-1.5 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted">
        <h3>
          {pending ? (
            title
          ) : (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-left wrap-anywhere text-inherit underline-offset-4 [font:inherit] hover:text-earth hover:underline hover:decoration-current"
              aria-haspopup="dialog"
              title={document.filename}
              onClick={(event) => {
                event.currentTarget.focus()
                onSelect(document.id)
              }}
            >
              {title}
            </button>
          )}
          {(document.version_number ?? 1) > 1 && (
            <span className="ml-2 rounded-[7px] bg-[#f3e3d9] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[#3d3d3a]">
              v{document.version_number}
            </span>
          )}
        </h3>
        <p>
          <span>{formatFileSize(document.size_bytes)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={document.created_at}>
            {formatUploadDate(document.created_at)}
          </time>
        </p>
      </div>
      <DocumentStatusBadge status={document.status} />
    </li>
  )
}
