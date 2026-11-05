import { useId, useState } from 'react'
import { Button } from '../../../components/Button'
import {
  DEFAULT_OPTIONS,
  LENGTHS,
  MAX_FOCUS_LENGTH,
  titleCase,
  TONES,
} from './customSummaryApi'
import { useCustomSummary } from './useCustomSummary'

// A row of choices that reads as one control: the chosen one is raised, the rest are flat.
function Choice({ legend, name, values, value, disabled, onChange }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-[11px] font-semibold tracking-[0.04em] text-muted uppercase">
        {legend}
      </legend>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-[10px] bg-[#efede4] p-1">
        {values.map((item) => (
          <label key={item} className="relative">
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={item}
              checked={value === item}
              onChange={() => onChange(item)}
            />
            <span className="block cursor-pointer rounded-[7px] px-3 py-1.5 text-[12px] font-semibold text-muted peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-[0_1px_2px_#1414131f] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:cursor-default peer-disabled:opacity-60 hover:text-ink">
              {titleCase(item)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// Length, tone and focus for a differently written summary. The result is handed to
// `onGenerated`, which shows it where the saved summary is; `active` says it is showing.
export function CustomSummary({ id, onGenerated, active = false }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const { state, generate } = useCustomSummary(id)
  const group = useId()
  const busy = state.status === 'generating'

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const data = await generate(options)
    if (data) onGenerated?.({ ...data, options })
  }

  return (
    <details className="group mt-6 rounded-xl border border-panel-border bg-panel-footer">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 marker:hidden hover:bg-[#f1efe6] [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f3e3d9] text-earth">
          <svg
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path
              d="M3 6h8m4 0h2M3 14h2m4 0h8M11 4v4M7 12v4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">
            Customize the summary
          </span>
          <span className="block text-[12px] text-muted">
            Choose a length, tone and focus
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <form
        className="grid gap-5 border-t border-panel-border px-4 pt-4 pb-4"
        onSubmit={(event) => void submit(event)}
        aria-label="Custom summary options"
      >
        <Choice
          legend="Length"
          name={`${group}-length`}
          values={LENGTHS}
          value={options.length}
          disabled={busy}
          onChange={(length) => setOptions({ ...options, length })}
        />
        <Choice
          legend="Tone"
          name={`${group}-tone`}
          values={TONES}
          value={options.tone}
          disabled={busy}
          onChange={(tone) => setOptions({ ...options, tone })}
        />
        <label className="grid gap-2">
          <span className="text-[11px] font-semibold tracking-[0.04em] text-muted uppercase">
            Focus (optional)
          </span>
          <input
            className="w-full rounded-lg border border-panel-border bg-surface px-3 py-2.5 text-[13px] placeholder:text-muted disabled:opacity-60"
            type="text"
            maxLength={MAX_FOCUS_LENGTH}
            placeholder="For example: risks, deadlines, or costs"
            value={options.focus}
            disabled={busy}
            onChange={(event) =>
              setOptions({ ...options, focus: event.currentTarget.value })
            }
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button type="submit" variant="primary" aria-disabled={busy}>
            {busy ? 'Writing…' : 'Generate custom summary'}
          </Button>
          <p className="min-w-[200px] flex-1 text-[11px] leading-[1.7] text-muted">
            The document text and your focus are sent to your configured AI
            provider; API charges may apply. The result replaces the summary
            above while you are here. The saved summary is not changed, and
            repeating the same options reuses the earlier result.
          </p>
        </div>
        {state.status === 'error' && (
          <p className="text-[13px] leading-[1.8] text-error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === 'success' && active && (
          <p className="text-[13px] leading-[1.8] text-success" role="status">
            Done. The custom summary is shown above.
          </p>
        )}
      </form>
    </details>
  )
}
