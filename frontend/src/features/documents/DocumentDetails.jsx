import { useEffect, useRef } from 'react'
import { Button } from '../../components/Button'
import {
  displayTitle,
  formatFileSize,
  formatUploadDate,
} from '../../lib/format'
import { DocumentStatusBadge } from './DocumentStatusBadge'
import { DocumentTitle } from './DocumentTitle'
import { DocumentTags } from './DocumentTags'
import { DocumentActions } from './DocumentActions'
import { DocumentVersions } from './DocumentVersions'
import { DocumentSummary } from './DocumentSummary'
import { DocumentInsights } from './DocumentInsights'
import { DocumentQuestion } from './DocumentQuestion'
import { DOCUMENT_STATUS_DESCRIPTIONS } from './status'
import { useDocument } from './useDocument'

export function DocumentDetails({
  id,
  onClose,
  onOpen,
  onVersionAdded,
  onDelete,
  onReprocess,
  onRename,
  statusGuess = null,
  titleGuess,
  liveRevision = 0,
  contentRevision = 0,
}) {
  const dialog = useRef(null)
  const { state, refresh, refreshQuietly, mergeData } = useDocument(id)
  const lastRevision = useRef(liveRevision)
  useEffect(() => {
    if (lastRevision.current === liveRevision) return
    lastRevision.current = liveRevision
    refreshQuietly()
  }, [liveRevision, refreshQuietly])

  // What to show for the status: a guess made ahead of the server, while it still applies.
  const loaded = state.status === 'success' ? state.data : null
  const status =
    loaded && statusGuess?.from === loaded.status
      ? statusGuess.to
      : loaded?.status

  // A rename shown ahead of the server (null means "show the file name"), while it applies.
  const renamedAhead = titleGuess !== undefined
  const title = loaded
    ? displayTitle(renamedAhead ? { ...loaded, title: titleGuess } : loaded)
    : null
  const titleSource = renamedAhead
    ? titleGuess
      ? 'user'
      : null
    : loaded?.title_source

  async function reprocess() {
    mergeData(await onReprocess(id, state.data.status, title))
    refreshQuietly()
  }

  async function rename(value) {
    mergeData(await onRename(id, value, title))
  }

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
      className="m-auto max-h-[calc(100svh-40px)] w-[min(680px,calc(100%-32px))] overflow-auto rounded-[18px] border border-panel-border bg-surface p-0 text-ink shadow-[0_24px_100px_#14141326] backdrop:bg-[#141413b3]"
      aria-labelledby="details-heading"
      onCancel={onClose}
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <div>
          <p className="mb-2.5 text-[10px] font-[650] tracking-[1.6px] text-earth">
            INSIDE YOUR VAULT
          </p>
          <h2
            className="font-serif text-[28px] font-normal tracking-[-0.5px] max-[600px]:text-2xl"
            id="details-heading"
          >
            Document details
          </h2>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div
        className="p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]"
        aria-busy={state.status === 'loading'}
      >
        {state.status === 'loading' && (
          <p
            className="my-[1em] text-[13px] leading-[1.8] text-muted"
            role="status"
          >
            Loading document details…
          </p>
        )}
        {state.status === 'error' && (
          <div
            role="alert"
            className="[&_h3]:mb-[1em] [&_h3]:text-base [&_h3]:font-bold [&_p]:my-[1em] [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-muted"
          >
            <h3>We couldn’t open this document.</h3>
            <p>{state.message}</p>
          </div>
        )}
        {state.status === 'success' && (
          <>
            <DocumentTitle
              title={title}
              source={titleSource}
              onRename={rename}
            />
            <DocumentStatusBadge status={status} />
            <p className="my-[1em] text-[13px] leading-[1.8] text-muted">
              {DOCUMENT_STATUS_DESCRIPTIONS[status]}
            </p>
            <DocumentTags
              key={`${id}:${contentRevision}`}
              id={id}
              status={status}
              category={state.data.category}
              tags={state.data.tags}
            />
            <div className="mt-6">
              <DocumentQuestion key={id} id={id} documentStatus={status} />
            </div>
            <DocumentSummary
              key={`summary:${contentRevision}`}
              id={id}
              documentStatus={status}
            />
            <DocumentInsights
              key={`insights:${contentRevision}`}
              id={id}
              documentStatus={status}
            />
            <details className="border-t border-rule py-5">
              <summary className="cursor-pointer py-1 text-[15px] font-semibold select-none">
                File details
              </summary>
              <dl className="mt-5 grid grid-cols-2 gap-[22px] max-[600px]:grid-cols-1 [&_dd]:leading-[1.6] [&_dd]:wrap-anywhere [&_dt]:mb-2 [&_dt]:text-[11px] [&_dt]:text-muted">
                <div className="col-span-full">
                  <dt>File name</dt>
                  <dd className="text-[13px]">{state.data.filename}</dd>
                </div>
                <div>
                  <dt>File size</dt>
                  <dd className="text-[13px]">
                    {formatFileSize(state.data.size_bytes)}
                  </dd>
                </div>
                <div>
                  <dt>File type</dt>
                  <dd className="text-[13px]">{state.data.content_type}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd className="text-[13px]">
                    <time dateTime={state.data.created_at}>
                      {formatUploadDate(state.data.created_at)}
                    </time>
                  </dd>
                </div>
                <div className="col-span-full">
                  <dt>Document ID</dt>
                  <dd className="font-mono text-xs">{state.data.id}</dd>
                </div>
              </dl>
            </details>
            <DocumentVersions
              key={`versions:${id}`}
              id={id}
              onOpen={onOpen}
              onVersionAdded={onVersionAdded}
            />
            <DocumentActions
              key={`actions:${id}`}
              status={status}
              onDelete={() => onDelete(id, title)}
              onReprocess={reprocess}
            />
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5 [&_p]:text-[11px] [&_p]:text-muted">
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
