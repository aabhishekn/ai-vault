import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { AnswerResult } from './AnswerResult'
import { MAX_QUESTION_LENGTH } from './answers'
import { useDocumentChat } from './useDocumentChat'

// Ask one question across several chosen documents; each cited passage names its document.
export function MultiDocumentChat({ documents, onClose }) {
  const dialog = useRef(null)
  const input = useRef(null)
  const [question, setQuestion] = useState('')
  const ids = [...documents.keys()]
  const { turns, pendingQuestion, streamingText, error, send } =
    useDocumentChat(null, 'ready', ids)
  const busy = pendingQuestion !== null

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (await send(question)) setQuestion('')
  }

  return (
    <dialog
      ref={dialog}
      className="m-auto max-h-[calc(100svh-40px)] w-[min(620px,calc(100%-32px))] overflow-auto rounded-[18px] border border-panel-border bg-surface p-0 text-ink shadow-[0_24px_100px_#13251c33] backdrop:bg-[#17291dcc]"
      aria-labelledby="multi-heading"
      onCancel={onClose}
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <div>
          <p className="mb-2.5 text-[10px] font-[650] tracking-[1.6px] text-earth">
            ACROSS YOUR VAULT
          </p>
          <h2
            className="font-serif text-[28px] font-normal tracking-[-0.5px] max-[600px]:text-2xl"
            id="multi-heading"
          >
            Ask {documents.size} documents
          </h2>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div className="p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <ul className="mb-5 flex list-none flex-wrap gap-2">
          {[...documents].map(([id, name]) => (
            <li
              key={id}
              className="rounded-[7px] bg-[#e4ead9] px-2 py-1 text-[11px] font-semibold wrap-anywhere text-[#3e4a37]"
            >
              {name}
            </li>
          ))}
        </ul>
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
              Searching {documents.size} documents for “{pendingQuestion}”…
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
            </div>
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
            htmlFor="multi-question"
            className="mb-2 block text-xs font-semibold"
          >
            {turns.length ? 'Your follow-up question' : 'Your question'}
          </label>
          <textarea
            ref={input}
            id="multi-question"
            rows={3}
            maxLength={MAX_QUESTION_LENGTH}
            value={question}
            disabled={busy}
            className="w-full resize-y rounded-lg border border-panel-border bg-surface px-3 py-2 text-[13px] leading-[1.8] disabled:opacity-60"
            onChange={(event) => setQuestion(event.currentTarget.value)}
          />
          <p className="mt-2 text-xs leading-[1.8] text-muted">
            Your question, recent conversation, and the most relevant passages
            from these documents are sent to your configured AI provider. API
            charges may apply.
          </p>
          <Button type="submit" className="mt-4" aria-disabled={busy}>
            {busy ? 'Finding an answer…' : 'Ask question'}
          </Button>
        </form>
      </div>
    </dialog>
  )
}
