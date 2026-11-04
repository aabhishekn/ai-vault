import { formatFileSize, formatUploadDate } from '../../lib/format'
import { canAskDocument } from './answers'
import { DocumentStatusBadge } from './DocumentStatusBadge'
import { TagChips } from './TagChips'

export function DocumentRow({ document, onSelect, chosen = false, onChoose }) {
  return (
    <li className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-4 px-[26px] py-6 not-first:border-t not-first:border-rule max-[600px]:grid-cols-[34px_minmax(0,1fr)] max-[600px]:items-start max-[600px]:gap-3 max-[600px]:px-[18px] max-[600px]:py-[22px]">
      <span
        className="grid h-12 w-[42px] place-items-center rounded-lg border border-evidence-border bg-[#f2f4ec] text-[#71816a] max-[600px]:h-10 max-[600px]:w-[34px] [&_svg]:size-[23px]"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
          <path d="M14 3v5h5M8 13h8m-8 4h5" />
        </svg>
      </span>
      <div className="[&_h3]:mb-[7px] [&_h3]:text-[13px] [&_h3]:leading-normal [&_h3]:font-[550] [&_h3]:wrap-anywhere [&_p]:flex [&_p]:flex-wrap [&_p]:gap-1.5 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted max-[600px]:[&_p]:text-[10px]">
        <h3>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-left wrap-anywhere text-inherit underline decoration-[#b9c4ae] underline-offset-4 [font:inherit] hover:text-success hover:decoration-current"
            aria-haspopup="dialog"
            onClick={(event) => {
              event.currentTarget.focus()
              onSelect(document.id)
            }}
          >
            {document.filename}
          </button>
          {(document.version_number ?? 1) > 1 && (
            <span className="ml-2 rounded-[7px] bg-[#e4ead9] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-[#3e4a37]">
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
        <div className="mt-2">
          <TagChips category={document.category} tags={document.tags} max={3} />
        </div>
      </div>
      <div className="flex items-center gap-3 max-[600px]:col-start-2">
        {onChoose && canAskDocument(document.status) && (
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              className="size-[18px] cursor-pointer"
              checked={chosen}
              onChange={() => onChoose(document)}
              aria-label={`Select for comparison or multi-document questions: ${document.filename}`}
            />
            Select
          </label>
        )}
        <DocumentStatusBadge status={document.status} />
      </div>
    </li>
  )
}
