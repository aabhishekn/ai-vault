import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { AnswerResult } from './AnswerResult'
import { canAskDocument, MAX_QUESTION_LENGTH } from './answers'
import type { DocumentStatus } from './types'
import { useDocumentChat } from './useDocumentChat'

export function DocumentQuestion({
  id,
  documentStatus,
}: {
  id: string
  documentStatus: DocumentStatus
}) {
  const [question, setQuestion] = useState('')
  const { turns, pendingQuestion, error, send } = useDocumentChat(
    id,
    documentStatus,
  )
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = pendingQuestion !== null
  const eligible = canAskDocument(documentStatus)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!eligible || busy) return
    if (await send(question)) setQuestion('')
  }

  // The field is disabled while busy, so focus only once it is enabled again.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) input.current?.focus()
    wasBusy.current = busy
  }, [busy])

  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="question-heading"
      aria-busy={busy}
    >
      <h3 id="question-heading" className="mb-3 text-[15px] font-semibold">
        Ask this document
      </h3>
      <p
        id="question-help"
        className="mb-4 text-[13px] leading-[1.8] text-muted"
      >
        {eligible
          ? 'Ask a question, then ask follow-ups. Each answer is supported by cited passages from this document.'
          : 'Questions need indexed document text. Refresh document details once processing finishes and the document is search ready.'}
      </p>
      <div role="log" aria-label="Conversation" aria-live="polite">
        <ol className="grid list-none gap-6">
          {turns.map((turn) => (
            <li key={turn.id}>
              <AnswerResult result={turn.answer} />
            </li>
          ))}
        </ol>
        {busy && (
          <p
            className="mt-4 text-[13px] leading-[1.8] text-muted"
            role="status"
          >
            Finding relevant passages for “{pendingQuestion}”. Keep this view
            open; this may take a moment.
          </p>
        )}
      </div>
      {error && (
        <p className="mt-4 text-[13px] leading-[1.8] text-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="mt-6"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <label
          htmlFor="document-question"
          className="mb-2 block text-xs font-semibold"
        >
          {turns.length ? 'Your follow-up question' : 'Your question'}
        </label>
        <textarea
          ref={input}
          id="document-question"
          rows={3}
          maxLength={MAX_QUESTION_LENGTH}
          required
          value={question}
          disabled={busy || !eligible}
          aria-describedby="question-help question-cost question-context"
          className="w-full resize-y rounded-lg border border-panel-border bg-surface px-3 py-2 text-[13px] leading-[1.8] disabled:opacity-60"
          onChange={(event) => setQuestion(event.currentTarget.value)}
        />
        <p id="question-cost" className="mt-2 text-xs leading-[1.8] text-muted">
          Your question, recent conversation, and relevant document text are
          sent to your configured AI provider. API charges may apply.
        </p>
        <p
          id="question-context"
          className="mt-2 text-xs leading-[1.8] text-muted"
        >
          The conversation is saved on the server. Closing details clears this
          view.
        </p>
        <Button
          type="submit"
          className="mt-4"
          aria-disabled={busy || !eligible}
        >
          {busy ? 'Finding an answer…' : 'Ask question'}
        </Button>
      </form>
    </section>
  )
}
