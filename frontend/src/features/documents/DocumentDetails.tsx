import { useEffect, useRef } from 'react'
import { Button } from '../../components/Button'
import { formatFileSize, formatUploadDate } from '../../lib/format'
import { DocumentStatusBadge } from './DocumentStatusBadge'
import { DocumentSummary } from './DocumentSummary'
import { DOCUMENT_STATUS_DESCRIPTIONS } from './status'
import { useDocument } from './useDocument'
import './DocumentDetails.css'

export function DocumentDetails({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { state, refresh } = useDocument(id)

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="document-details"
      aria-labelledby="details-heading"
      onCancel={onClose}
    >
      <div className="details-header">
        <div>
          <p className="details-eyebrow">INSIDE YOUR VAULT</p>
          <h2 id="details-heading">Document details</h2>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div className="details-body" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <p className="details-message" role="status">
            Loading document details…
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="details-error">
            <h3>We couldn’t open this document.</h3>
            <p>{state.message}</p>
          </div>
        )}
        {state.status === 'success' && (
          <>
            <h3 className="details-filename">{state.document.filename}</h3>
            <DocumentStatusBadge status={state.document.status} />
            <p className="details-status-description">
              {DOCUMENT_STATUS_DESCRIPTIONS[state.document.status]}
            </p>
            <dl className="details-metadata">
              <div>
                <dt>File size</dt>
                <dd>{formatFileSize(state.document.size_bytes)}</dd>
              </div>
              <div>
                <dt>File type</dt>
                <dd>{state.document.content_type}</dd>
              </div>
              <div>
                <dt>Uploaded</dt>
                <dd>
                  <time dateTime={state.document.created_at}>
                    {formatUploadDate(state.document.created_at)}
                  </time>
                </dd>
              </div>
              <div className="details-id">
                <dt>Document ID</dt>
                <dd>{state.document.id}</dd>
              </div>
            </dl>
            <DocumentSummary id={id} documentStatus={state.document.status} />
          </>
        )}
        <div className="details-footer">
          <p>Refresh to get the latest processing status.</p>
          <Button
            onClick={() => {
              if (state.status !== 'loading') refresh()
            }}
            aria-disabled={state.status === 'loading'}
          >
            {state.status === 'error' ? 'Try again' : 'Refresh details'}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
