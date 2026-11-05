import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { TabList, TabPanel } from '../../components/Tabs'
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
import { canAskDocument } from './answers'
import { DOCUMENT_STATUS_HINTS } from './status'
import { useDocument } from './useDocument'

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'details', label: 'Details' },
]

export function DocumentDetails({
  onAsk,
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

  // Until a tab is picked: the summary once there is something to ask about, else Details.
  const [pickedTab, setPickedTab] = useState(null)
  const tab = pickedTab ?? (canAskDocument(status) ? 'summary' : 'details')

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
      aria-labelledby={loaded ? 'details-heading' : undefined}
      aria-label={loaded ? undefined : 'Document'}
      onCancel={onClose}
    >
      <button
        type="button"
        className="absolute top-3.5 right-3.5 z-10 grid size-9 cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-[#efede4] hover:text-ink"
        aria-label="Close"
        onClick={onClose}
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className="p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]"
        aria-busy={state.status === 'loading'}
      >
        {state.status === 'loading' && (
          <p className="text-[13px] leading-[1.8] text-muted" role="status">
            Loading…
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="pr-10">
            <h3 className="mb-2 text-base font-semibold">
              We couldn’t open this document.
            </h3>
            <p className="mb-4 text-[13px] leading-[1.8] text-muted">
              {state.message}
            </p>
            <Button onClick={refresh}>Try again</Button>
          </div>
        )}
        {state.status === 'success' && (
          <>
            <DocumentTitle
              title={title}
              source={titleSource}
              onRename={rename}
            />
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <DocumentStatusBadge status={status} />
              {DOCUMENT_STATUS_HINTS[status] && (
                <span className="text-[13px] text-muted">
                  {DOCUMENT_STATUS_HINTS[status]}
                </span>
              )}
              {status === 'failed' && state.data.error_message && (
                <p className="basis-full text-[13px] leading-[1.7] text-error">
                  {state.data.error_message}
                </p>
              )}
              {canAskDocument(status) && (
                <Button
                  className="ml-auto"
                  variant="primary"
                  onClick={() => onAsk(id, title)}
                >
                  Ask about this document
                </Button>
              )}
            </div>
            <TabList
              idBase="document"
              label="Document sections"
              tabs={TABS}
              active={tab}
              onChange={setPickedTab}
            />
            <div className="[&_section:first-child]:border-t-0">
              <TabPanel idBase="document" tab="summary" active={tab}>
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
              </TabPanel>
              <TabPanel idBase="document" tab="details" active={tab}>
                <DocumentTags
                  key={`${id}:${contentRevision}`}
                  id={id}
                  status={status}
                  category={state.data.category}
                  tags={state.data.tags}
                />
                <dl className="grid grid-cols-2 gap-[18px] border-t border-rule py-6 max-[600px]:grid-cols-1 [&_dd]:text-[13px] [&_dd]:leading-[1.6] [&_dd]:wrap-anywhere [&_dt]:mb-1.5 [&_dt]:text-[11px] [&_dt]:text-muted">
                  <div className="col-span-full">
                    <dt>File name</dt>
                    <dd>{state.data.filename}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatFileSize(state.data.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt>Uploaded</dt>
                    <dd>
                      <time dateTime={state.data.created_at}>
                        {formatUploadDate(state.data.created_at)}
                      </time>
                    </dd>
                  </div>
                </dl>
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
              </TabPanel>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}
