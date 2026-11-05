import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { MAX_QUESTION_LENGTH } from './answers'

// Edits a question that was already asked. Saving asks it again and replaces the old answer.
// `original` is what was asked; `draft` is what the box starts with (they differ when a
// failed resend brings the edited text back).
export function QuestionEditor({ original, draft, onSave, onCancel }) {
  const [text, setText] = useState(draft)
  const field = useRef(null)
  const id = useId()
  const trimmed = text.trim()
  const ready = trimmed !== '' && trimmed !== original.trim()

  useEffect(() => {
    const element = field.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  // The box grows with what is typed, up to a few lines.
  useEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    if (element.scrollHeight)
      element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [text])

  function save() {
    if (ready) onSave(trimmed)
  }

  return (
    <form
      className="ml-auto grid w-full max-w-[88%] gap-2.5 rounded-2xl border border-focus bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <label htmlFor={id} className="sr-only">
        Edit your question
      </label>
      <textarea
        ref={field}
        id={id}
        rows={2}
        maxLength={MAX_QUESTION_LENGTH}
        value={text}
        className="max-h-[200px] min-h-[52px] w-full resize-none border-0 bg-transparent text-[14px] leading-[1.65] outline-none"
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            save()
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[12px] leading-[1.5] text-muted">
          The question is asked again and the answer replaces the old one.
        </p>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" aria-disabled={!ready}>
            Save and resend
          </Button>
        </div>
      </div>
    </form>
  )
}
