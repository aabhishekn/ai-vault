import { useState } from 'react'
import { Button } from '../../components/Button'
import { classifyDocument } from './classification'
import { TagChips } from './TagChips'
import type { DocumentStatus } from './types'

const CAN_CLASSIFY: DocumentStatus[] = ['extracted', 'embedded', 'ready']

export function DocumentTags({
  id,
  status,
  category,
  tags,
}: {
  id: string
  status: DocumentStatus
  category?: string | null
  tags?: string[]
}) {
  const [added, setAdded] = useState<{
    category: string
    tags: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownCategory = added?.category ?? category
  const shownTags = added?.tags ?? tags ?? []

  async function addTags() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setAdded(await classifyDocument(id, AbortSignal.timeout(60_000)))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not add tags.')
    } finally {
      setBusy(false)
    }
  }

  if (shownCategory)
    return (
      <div className="mt-4">
        <TagChips category={shownCategory} tags={shownTags} />
      </div>
    )
  if (!CAN_CLASSIFY.includes(status)) return null
  return (
    <div className="mt-4">
      <Button onClick={() => void addTags()} aria-disabled={busy}>
        {busy ? 'Adding tags…' : 'Add category and tags'}
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
