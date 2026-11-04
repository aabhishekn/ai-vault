import { formatFileSize, formatUploadDate } from '../../lib/format'
import { DocumentStatusBadge } from './DocumentStatusBadge'
import type { VaultDocument } from './types'

export function DocumentRow({ document }: { document: VaultDocument }) {
  return (
    <li className="document-row">
      <span className="document-file-icon" aria-hidden="true">
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
      <div className="document-description">
        <h3>{document.filename}</h3>
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
