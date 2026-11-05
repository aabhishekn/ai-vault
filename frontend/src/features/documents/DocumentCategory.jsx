import { useState } from 'react'
import { Button } from '../../components/Button'
import { classifyDocument } from './classification'

const CAN_CLASSIFY = ['extracted', 'embedded', 'ready']

// The document's category as a small label, or (for a document that has none yet) a button
// that asks the AI to name it once.
export function DocumentCategory({ id, status, category }) {
  const [added, setAdded] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const shown = added?.category ?? category

  async function addCategory() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setAdded(await classifyDocument(id, AbortSignal.timeout(60_000)))
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not add a category.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (shown)
    return (
      <p className="mt-4">
        <span className="sr-only">Category: </span>
        <span className="inline-block rounded-[7px] bg-[#f3e3d9] px-2 py-0.5 text-[11px] font-semibold text-[#3d3d3a]">
          {shown}
        </span>
      </p>
    )
  if (!CAN_CLASSIFY.includes(status)) return null
  return (
    <div className="mt-4">
      <Button onClick={() => void addCategory()} aria-disabled={busy}>
        {busy ? 'Adding category…' : 'Add category'}
      </Button>
      <p className="mt-2 text-xs leading-[1.8] text-muted">
        Uses AI on your saved summary; API charges may apply.
      </p>
      {error && (
        <p className="mt-2 text-[13px] text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
