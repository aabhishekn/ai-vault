import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { AnswerResult } from './AnswerResult'
import { canAskDocument, MAX_QUESTION_LENGTH } from './answers'

import { useDocumentChat } from './useDocumentChat'
import { useSuggestedQuestions } from './useSuggestedQuestions'

export function DocumentQuestion({ id, documentStatus }) {
  const [question, setQuestion] = useState('')
  const {
    turns,
    pendingQuestion,
    streamingText,
    error,
    restoring,
    send,
    startNewConversation,
  } = useDocumentChat(id, documentStatus)
  const suggestions = useSuggestedQuestions(id)
  const input = useRef(null)
  const busy = pendingQuestion !== null
  const locked = busy || restoring
  const eligible = canAskDocument(documentStatus)

  async function submit(event) {
    event.preventDefault()
    if (!eligible || locked) return
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
      {restoring && (
        <p className="mb-4 text-[13px] leading-[1.8] text-muted" role="status">
          Loading your previous conversation…
        </p>
      )}
      <div role="log" aria-label="Conversation" aria-live="polite">
        <ol className="grid list-none gap-6">
          {turns.map((turn) => (
            <li key={turn.id}>
              <AnswerResult result={turn.answer} />
            </li>
          ))}
        </ol>
        {busy && !streamingText && (
          <p
            className="mt-4 text-[13px] leading-[1.8] text-muted"
            role="status"
          >
            Finding relevant passages for “{pendingQuestion}”. Keep this view
            open; this may take a moment.
          </p>
        )}
        {busy && streamingText && (
          <div className="mt-4 wrap-anywhere" aria-live="off">
            <p className="mb-2 text-[11px] font-semibold text-muted">
              Answering “{pendingQuestion}”
            </p>
            <p className="text-[13px] leading-[1.9] whitespace-pre-wrap">
              {streamingText}
            </p>
            <p className="mt-2 text-xs text-muted">
              Sources appear once the answer is complete.
            </p>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-4 text-[13px] leading-[1.8] text-error" role="alert">
          {error}
        </p>
      )}
      {eligible && turns.length === 0 && !restoring && !busy && (
        <div className="mt-6">
          {suggestions.questions.length === 0 ? (
            <Button
              onClick={() => void suggestions.suggest()}
              aria-disabled={suggestions.loading}
            >
              {suggestions.loading
                ? 'Thinking of questions…'
                : 'Suggest questions'}
            </Button>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold">Try asking</p>
              <ul className="grid list-none gap-2">
                {suggestions.questions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      className="rounded-lg border border-panel-border bg-surface px-3 py-2 text-left text-[13px] leading-[1.8] hover:border-ink"
                      onClick={() => {
                        setQuestion(suggestion)
                        input.current?.focus()
                      }}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-xs leading-[1.8] text-muted">
            Suggestions are built from your saved summary and insights. The
            first request for a document uses the AI provider and may incur a
            small charge.
          </p>
          {suggestions.error && (
            <p
              className="mt-2 text-[13px] leading-[1.8] text-error"
              role="alert"
            >
              {suggestions.error}
            </p>
          )}
        </div>
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
          disabled={locked || !eligible}
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
          The conversation is saved on the server and restored when you reopen
          this document.
        </p>
        <Button
          type="submit"
          className="mt-4"
          aria-disabled={locked || !eligible}
        >
          {busy ? 'Finding an answer…' : 'Ask question'}
        </Button>
        {turns.length > 0 && !busy && (
          <Button
            className="mt-4 ml-2"
            onClick={() => {
              startNewConversation()
              setQuestion('')
              input.current?.focus()
            }}
          >
            New conversation
          </Button>
        )}
      </form>
    </section>
  )
}
