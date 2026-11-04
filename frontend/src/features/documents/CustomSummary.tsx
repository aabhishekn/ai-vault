import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import {
  DEFAULT_OPTIONS,
  LENGTHS,
  MAX_FOCUS_LENGTH,
  TONES,
  type SummaryOptions,
} from './customSummaryApi'
import { useCustomSummary } from './useCustomSummary'

const field =
  'w-full rounded-lg border border-panel-border bg-surface px-3 py-2 text-[13px] disabled:opacity-60'

export function CustomSummary({ id }: { id: string }) {
  const [options, setOptions] = useState<SummaryOptions>(DEFAULT_OPTIONS)
  const { state, generate } = useCustomSummary(id)
  const busy = state.status === 'generating'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy) void generate(options)
  }

  return (
    <details className="mt-5 rounded-[10px] border border-panel-border p-4">
      <summary className="cursor-pointer text-xs font-semibold">
        Customize the summary
      </summary>
      <form
        className="mt-4 grid gap-3"
        onSubmit={submit}
        aria-label="Custom summary options"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold">
            Length
            <select
              className={field}
              value={options.length}
              disabled={busy}
              onChange={(event) =>
                setOptions({
                  ...options,
                  length: event.currentTarget.value as SummaryOptions['length'],
                })
              }
            >
              {LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {value[0]?.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold">
            Tone
            <select
              className={field}
              value={options.tone}
              disabled={busy}
              onChange={(event) =>
                setOptions({
                  ...options,
                  tone: event.currentTarget.value as SummaryOptions['tone'],
                })
              }
            >
              {TONES.map((value) => (
                <option key={value} value={value}>
                  {value[0]?.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-xs font-semibold">
          Focus (optional)
          <input
            className={field}
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
        <p className="text-xs leading-[1.8] text-muted">
          Document text and your focus are sent to your configured AI provider.
          API charges may apply. Custom summaries are not saved on the document;
          repeating the same options reuses the earlier result.
        </p>
        <div>
          <Button type="submit" aria-disabled={busy}>
            {busy ? 'Writing…' : 'Generate custom summary'}
          </Button>
        </div>
      </form>
      {state.status === 'error' && (
        <p className="mt-4 text-[13px] leading-[1.9] text-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <div className="mt-4" role="status">
          <p className="mb-2 text-[11px] font-semibold text-muted">
            Custom summary{state.data.cached ? ' · reused from earlier' : ''}
          </p>
          <p className="text-[13px] leading-[1.9] wrap-anywhere whitespace-pre-wrap">
            {state.data.summary}
          </p>
        </div>
      )}
    </details>
  )
}
