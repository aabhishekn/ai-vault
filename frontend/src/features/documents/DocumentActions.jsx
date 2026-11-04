import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ApiError } from '../../lib/api'
import { canProcessAgain, deleteDocument, reprocessDocument } from './manage'

const REPROCESS_HELP = {
  failed:
    'Processing failed. Try again to re-extract the text and rebuild the search index. Embedding the text uses a small amount of API credit.',
  extracted:
    'Text is extracted but the search index is not built yet. Process again to finish it and enable questions. Embedding the text uses a small amount of API credit.',
}

export function DocumentActions({ id, status, onDeleted, onReprocessed }) {
  // null | 'processing' | 'deleting'
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const deleteButton = useRef(null)
  const cancelButton = useRef(null)
  const wasConfirming = useRef(false)

  // Move focus into the confirmation, and back to Delete if it is dismissed.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus()
    else if (wasConfirming.current) deleteButton.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  async function run(kind, action) {
    if (busy) return
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong.',
      )
    } finally {
      setBusy(null)
    }
  }

  const processAgain = () =>
    run('processing', async () => {
      await reprocessDocument(id, AbortSignal.timeout(30_000))
      setNotice('Queued for processing. Its status updates here shortly.')
      onReprocessed()
    })

  const remove = () =>
    run('deleting', async () => {
      await deleteDocument(id, AbortSignal.timeout(30_000))
      onDeleted()
    })

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
          <Button onClick={() => void processAgain()} disabled={busy !== null}>
            {busy === 'processing' ? 'Queueing…' : 'Process again'}
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
          disabled={busy !== null}
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
            insights, chat history and the stored PDF. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={cancelButton}
              onClick={() => setConfirming(false)}
              disabled={busy === 'deleting'}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void remove()}
              disabled={busy === 'deleting'}
            >
              {busy === 'deleting' ? 'Deleting…' : 'Delete permanently'}
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
