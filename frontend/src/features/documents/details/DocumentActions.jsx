import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { ApiError } from '../../../lib/api'
import { canProcessAgain } from '../manage'

const REPROCESS_HELP = {
  failed:
    'Processing failed. Try again to re-extract the text and rebuild the search index. Embedding the text uses a small amount of API credit.',
  extracted:
    'Text is extracted but the search index is not built yet. Process again to finish it and enable questions. Embedding the text uses a small amount of API credit.',
}

const QUEUED_NOTICE = 'Queued for processing. Its status updates here shortly.'

// `onReprocess` resolves once queued and rejects with an ApiError if refused. `onDelete`
// closes the dialog straight away; if the server refuses, the page says so.
export function DocumentActions({ status, onDelete, onReprocess }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const deleteButton = useRef(null)
  const cancelButton = useRef(null)
  const wasConfirming = useRef(false)
  const deleteRequested = useRef(false)

  // Move focus into the confirmation, and back to Delete if it is dismissed.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus()
    else if (wasConfirming.current) deleteButton.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  async function processAgain() {
    if (busy) return
    setBusy(true)
    setError(null)
    // Say it is queued right away; the notice is withdrawn if the server refuses.
    setNotice(QUEUED_NOTICE)
    try {
      await onReprocess()
    } catch (caught) {
      setNotice(null)
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong.',
      )
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    if (deleteRequested.current) return
    deleteRequested.current = true
    onDelete()
  }

  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="manage-heading"
    >
      <h3 id="manage-heading" className="mb-3 text-[15px] font-semibold">
        Manage
      </h3>
      {canProcessAgain(status) && (
        <div className="mb-5">
          <p className="mb-3 text-[13px] leading-[1.8] text-muted">
            {REPROCESS_HELP[status]}
          </p>
          <Button onClick={() => void processAgain()} disabled={busy}>
            {busy ? 'Queueing…' : 'Process again'}
          </Button>
        </div>
      )}
      {!confirming ? (
        <Button
          ref={deleteButton}
          variant="danger"
          onClick={() => {
            setError(null)
            setNotice(null)
            setConfirming(true)
          }}
          disabled={busy}
        >
          Delete document…
        </Button>
      ) : (
        <div
          role="group"
          aria-labelledby="delete-heading"
          className="rounded-[12px] border border-[#e6c9c3] bg-[#fffaf7] p-4"
        >
          <p id="delete-heading" className="mb-1 text-[13px] font-semibold">
            Delete this document permanently?
          </p>
          <p className="mb-4 text-[13px] leading-[1.8] text-muted">
            This removes the document, all of its versions, its summary,
            insights, chat history and the stored file. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={cancelButton} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete permanently
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p className="mt-3 text-[13px] text-muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 text-[13px] text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
