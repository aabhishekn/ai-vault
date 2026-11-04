import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { AnswerResult } from './AnswerResult'
import { canAskDocument, MAX_QUESTION_LENGTH } from './answers'
import type { DocumentStatus } from './types'
import { useDocumentAnswer } from './useDocumentAnswer'

export function DocumentQuestion({
  id,
  documentStatus,
}: {
  id: string
  documentStatus: DocumentStatus
}) {
  const [question, setQuestion] = useState('')
  const { state, ask } = useDocumentAnswer(id, documentStatus)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = state.status === 'asking'
  const eligible = canAskDocument(documentStatus)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!eligible || busy) return
    await ask(question)
    heading.current?.focus()
  }

  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="question-heading"
      aria-busy={busy}
    >
      <h3
        ref={heading}
        tabIndex={-1}
        id="question-heading"
        className="mb-3 text-[15px] font-semibold"
      >
        Ask this document
      </h3>
      <p
        id="question-help"
        className="mb-4 text-[13px] leading-[1.8] text-muted"
      >
        {eligible
          ? 'Ask a question and get an answer supported by passages from this document.'
          : 'Questions need indexed document text. Refresh document details once processing finishes and the document is search ready.'}
      </p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label
          htmlFor="document-question"
          className="mb-2 block text-xs font-semibold"
        >
          Your question
        </label>
        <textarea
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
          Your question and relevant document text are sent to your configured
          AI provider. API charges may apply.
        </p>
        <p
          id="question-context"
          className="mt-2 text-xs leading-[1.8] text-muted"
        >
          Each question is independent. Closing details clears this answer.
        </p>
        <Button
          type="submit"
          className="mt-4"
          aria-disabled={busy || !eligible}
        >
          {busy ? 'Finding an answer…' : 'Ask question'}
        </Button>
      </form>
      {state.status === 'asking' && (
        <p className="mt-4 text-[13px] leading-[1.8] text-muted" role="status">
          Finding relevant passages and preparing your answer. Keep this view
          open; this may take a moment.
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-4 text-[13px] leading-[1.8] text-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && <AnswerResult result={state.data} />}
    </section>
  )
}
