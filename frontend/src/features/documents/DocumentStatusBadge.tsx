import { STATUS_LABELS } from './status'
import type { DocumentStatus } from './types'

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`document-status document-status--${status}`}>
      <span className="document-status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  )
}
