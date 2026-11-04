import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { AnswerResult } from './AnswerResult'
import { canAskDocument, MAX_QUESTION_LENGTH } from './answers'

import { useDocumentChat } from './useDocumentChat'
import { useSuggestedQuestions } from './useSuggestedQuestions'

// One conversation: the thread, a few starters while it is empty, and the question box.
// Render it with key={scope.key}. With an `id` it is that document's conversation (its
// latest saved one is restored); with `documentIds` it spans those documents instead.
export function ChatThread({
  id = null,
  documentIds,
  documentStatus = 'ready',
  placeholder = 'Ask a question…',
  starters = [],
}) {
  const [question, setQuestion] = useState('')
  const {
    turns,
    pendingQuestion,
    streamingText,
    error,
    restoring,
    send,
    startNewConversation,
  } = useDocumentChat(id, documentStatus, documentIds)
  const suggestions = useSuggestedQuestions(id)
  const input = useRef(null)
  const scroller = useRef(null)
  const busy = pendingQuestion !== null
  const locked = busy || restoring
  const eligible = canAskDocument(documentStatus)
  const empty = turns.length === 0 && !restoring && !busy

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

  // A new answer opens at its own start, so a long one is read from the top; while one is
  // being written the view follows it.
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const latest = element.querySelector('ol > li:last-child')
    if (latest?.scrollIntoView) latest.scrollIntoView({ block: 'start' })
    else element.scrollTop = element.scrollHeight
  }, [turns.length, restoring])
  useEffect(() => {
    const element = scroller.current
    if (element && busy) element.scrollTop = element.scrollHeight
  }, [streamingText, busy])

  // The box grows with what is typed, up to a few lines.
  useEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    if (element.scrollHeight)
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [question])

  function fill(text) {
    setQuestion(text)
    input.current?.focus()
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-labelledby="question-heading"
      aria-busy={busy}
    >
      <h2 id="question-heading" className="sr-only">
        Conversation
      </h2>
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 max-[600px]:px-4"
      >
        {restoring && (
          <p className="text-[13px] leading-[1.8] text-muted" role="status">
            Loading your previous conversation…
          </p>
        )}
        {empty && (
          <div className="m-auto w-full max-w-[560px] py-8 text-center">
            <p className="font-serif text-[clamp(30px,4vw,40px)] leading-[1.1] tracking-[-0.03em]">
              Ask your documents.
            </p>
            <p
              id="question-help"
              className="mx-auto mt-3 max-w-[460px] text-[14px] leading-[1.7] text-muted"
            >
              {eligible
                ? 'Ask a question, then ask follow-ups. Each answer cites the page it came from.'
                : 'Questions need indexed document text. Try again once the document is search ready.'}
            </p>
            {eligible && (
              <div className="mt-6 grid gap-2 text-left">
                {id !== null && suggestions.questions.length === 0 && (
                  <div className="text-center">
                    <Button
                      onClick={() => void suggestions.suggest()}
                      aria-disabled={suggestions.loading}
                    >
                      {suggestions.loading
                        ? 'Thinking of questions…'
                        : 'Suggest questions'}
                    </Button>
                    <p className="mt-2 text-xs leading-[1.8] text-muted">
                      Built from your saved summary and insights. The first
                      request for a document uses the AI provider and may incur
                      a small charge.
                    </p>
                  </div>
                )}
                {[...(id !== null ? suggestions.questions : starters)].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="cursor-pointer rounded-xl border border-panel-border bg-surface px-4 py-3 text-left text-[13px] leading-[1.7] hover:border-ink"
                      onClick={() => fill(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ),
                )}
                {suggestions.error && (
                  <p
                    className="text-center text-[13px] leading-[1.8] text-error"
                    role="alert"
                  >
                    {suggestions.error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div role="log" aria-label="Conversation" aria-live="polite">
          <ol className="grid list-none gap-8">
            {turns.map((turn) => (
              <li key={turn.id}>
                <AnswerResult result={turn.answer} />
              </li>
            ))}
          </ol>
          {busy && !streamingText && (
            <p
              className="mt-6 text-[13px] leading-[1.8] text-muted"
              role="status"
            >
              Finding relevant passages for “{pendingQuestion}”. Keep this view
              open; this may take a moment.
            </p>
          )}
          {busy && streamingText && (
            <div className="mt-6 wrap-anywhere" aria-live="off">
              <p className="mb-2 text-[11px] font-semibold text-muted">
                Answering “{pendingQuestion}”
              </p>
              <p className="text-[14px] leading-[1.9] whitespace-pre-wrap">
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
      </div>
      <form
        className="border-t border-rule bg-surface px-6 pt-3 pb-4 max-[600px]:px-4"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <label htmlFor="document-question" className="sr-only">
          {turns.length ? 'Your follow-up question' : 'Your question'}
        </label>
        <div className="flex items-end gap-2 rounded-[14px] border border-panel-border bg-surface py-2 pr-2 pl-4 focus-within:border-ink">
          <textarea
            ref={input}
            id="document-question"
            rows={1}
            maxLength={MAX_QUESTION_LENGTH}
            required
            value={question}
            placeholder={placeholder}
            disabled={locked || !eligible}
            aria-describedby="question-help question-cost"
            className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent py-1 text-[14px] leading-[1.6] outline-none placeholder:text-muted disabled:opacity-60"
            onChange={(event) => setQuestion(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter adds a line (not while composing text).
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button
            type="submit"
            aria-label={busy ? 'Finding an answer…' : 'Ask question'}
            aria-disabled={locked || !eligible}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-ink text-surface aria-disabled:cursor-default aria-disabled:opacity-40"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path
                d="M10 16V4m0 0L5 9m5-5 5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-[1.6] text-muted">
          <p id="question-cost">
            Your question, recent conversation and relevant passages are sent to
            your configured AI provider. API charges may apply.
          </p>
          {turns.length > 0 && !busy && (
            <button
              type="button"
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold text-ink underline underline-offset-4 [font:inherit] hover:text-earth"
              onClick={() => {
                startNewConversation()
                setQuestion('')
                input.current?.focus()
              }}
            >
              New conversation
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
