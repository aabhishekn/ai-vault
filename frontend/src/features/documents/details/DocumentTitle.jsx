import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { ApiError } from '../../../lib/api'

const SOURCE_NOTE = {
  ai: 'Title written by AI from the document’s content.',
  user: 'Title set by you.',
}

// The document's title with a Rename button. Saving shows the new title at once; if the
// server refuses, the form opens again with what was typed and says why.
export function DocumentTitle({ title, source, onRename }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const input = useRef(null)
  const renameButton = useRef(null)
  const wasEditing = useRef(false)

  // Move focus into the form, and back to Rename once it closes.
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    } else if (wasEditing.current) renameButton.current?.focus()
    wasEditing.current = editing
  }, [editing])

  function open() {
    setDraft(title)
    setError(null)
    setEditing(true)
  }

  async function save(event) {
    event.preventDefault()
    const value = draft
    setEditing(false)
    if (value.trim() === title) return
    try {
      await onRename(value)
    } catch (caught) {
      setDraft(value)
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong.',
      )
      setEditing(true)
    }
  }

  if (editing) {
    return (
      <form className="mb-4 pr-10" onSubmit={(event) => void save(event)}>
        <label
          className="mb-2 block text-xs font-semibold"
          htmlFor="document-title"
        >
          Title
        </label>
        <input
          ref={input}
          id="document-title"
          className="w-full rounded-[7px] border border-[#d6d2c4] bg-surface px-3 py-2.5 text-sm"
          value={draft}
          maxLength={120}
          aria-describedby="document-title-help"
          aria-invalid={Boolean(error)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Escape closes this form, not the whole dialog.
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setEditing(false)
          }}
        />
        <p
          id="document-title-help"
          className="mt-2 text-[11px] leading-[1.6] text-muted"
        >
          Leave it empty to show the file name instead.
        </p>
        {error && (
          <p className="mt-2 text-[13px] text-error" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" variant="primary">
            Save title
          </Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    )
  }

  return (
    <div className="mb-4 pr-10">
      <div className="flex items-start justify-between gap-3">
        <h3
          id="details-heading"
          className="font-serif text-[22px] leading-snug font-normal tracking-[-0.3px] wrap-anywhere max-[600px]:text-[18px]"
        >
          {title}
        </h3>
        <Button ref={renameButton} onClick={open}>
          Rename
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        {SOURCE_NOTE[source] ?? 'Showing the file name. Rename to set a title.'}
      </p>
    </div>
  )
}
