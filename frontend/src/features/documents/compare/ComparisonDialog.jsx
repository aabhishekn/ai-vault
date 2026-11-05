import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { ApiError } from '../../../lib/api'
import { documentTitle } from '../../../lib/format'
import { compareDocuments, MAX_COMPARISON_FOCUS } from './comparison'

const TIMEOUT_MS = 120_000

// Compares the chosen documents side by side, optionally on one aspect.
export function ComparisonDialog({ documents, onClose }) {
  const dialog = useRef(null)
  const request = useRef(null)
  const [focus, setFocus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    element?.showModal()
    return () => {
      request.current?.abort()
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(null)
    try {
      const comparison = await compareDocuments(
        [...documents.keys()],
        focus,
        AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      )
      if (!controller.signal.aborted) setResult(comparison)
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'We couldn’t complete the comparison. Please try again.',
        )
    } finally {
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="m-auto max-h-[calc(100svh-40px)] w-[min(760px,calc(100%-32px))] overflow-auto rounded-[18px] border border-panel-border bg-surface p-0 text-ink shadow-[0_24px_100px_#14141326] backdrop:bg-[#141413b3]"
      aria-labelledby="comparison-heading"
      onCancel={onClose}
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <div>
          <p className="mb-2.5 text-[10px] font-[650] tracking-[1.6px] text-earth">
            SIDE BY SIDE
          </p>
          <h2
            className="font-serif text-[28px] font-normal tracking-[-0.5px] max-[600px]:text-2xl"
            id="comparison-heading"
          >
            Compare {documents.size} documents
          </h2>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div className="p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <ul className="mb-5 flex list-none flex-wrap gap-2">
          {[...documents].map(([id, name]) => (
            <li
              key={id}
              className="rounded-[7px] bg-[#f3e3d9] px-2 py-1 text-[11px] font-semibold wrap-anywhere text-[#3d3d3a]"
            >
              {name}
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label
            htmlFor="comparison-focus"
            className="mb-2 block text-xs font-semibold"
          >
            Focus on (optional)
          </label>
          <input
            id="comparison-focus"
            type="text"
            maxLength={MAX_COMPARISON_FOCUS}
            value={focus}
            disabled={loading}
            placeholder="for example payment terms or security requirements"
            className="w-full rounded-lg border border-panel-border bg-surface px-3 py-2 text-[13px] disabled:opacity-60"
            onChange={(event) => setFocus(event.currentTarget.value)}
          />
          <p className="mt-2 text-xs leading-[1.8] text-muted">
            Summaries, key insights and the most relevant passages of each
            document are sent to your configured AI provider. API charges may
            apply; repeating a comparison is free for a week.
          </p>
          <Button type="submit" className="mt-4" aria-disabled={loading}>
            {loading ? 'Comparing…' : result ? 'Compare again' : 'Compare'}
          </Button>
        </form>
        {error && (
          <p className="mt-4 text-[13px] leading-[1.8] text-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="mt-6 wrap-anywhere" aria-live="polite">
            <p className="font-serif text-base leading-[1.75]">
              {result.overview}
            </p>
            {result.similarities.length > 0 && (
              <>
                <h3 className="mt-5 mb-2 text-sm font-semibold">
                  What they share
                </h3>
                <ul className="grid list-disc gap-1.5 pl-5 font-serif text-[15px] leading-[1.7]">
                  {result.similarities.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </>
            )}
            {result.differences.length > 0 && (
              <>
                <h3 className="mt-5 mb-2 text-sm font-semibold">
                  Where they differ
                </h3>
                <div className="grid gap-4">
                  {result.differences.map((difference) => (
                    <section
                      key={difference.topic}
                      className="rounded-[10px] border border-evidence-border bg-[#f7f5ee] p-4"
                    >
                      <h4 className="mb-2 text-xs font-semibold">
                        {difference.topic}
                      </h4>
                      <dl className="grid gap-2 font-serif text-[15px] leading-[1.7] [&_dt]:font-sans">
                        {difference.positions.map((position) => (
                          <div key={position.document_id}>
                            <dt className="text-[11px] font-semibold text-muted">
                              {documents.get(position.document_id) ??
                                documentTitle(position.filename)}
                            </dt>
                            <dd>{position.statement}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}
