import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { ApiError } from '../../lib/api'
import { getHealth } from './api'

const healthStyles = {
  online: 'bg-success-soft text-success',
  checking: 'bg-warning-soft text-warning',
  offline: 'bg-danger-soft text-danger',
}

type HealthState =
  | { status: 'checking' }
  | { status: 'online' }
  | { status: 'offline'; message: string }

export function HealthCard() {
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(5_000),
    ])

    async function checkConnection() {
      try {
        await getHealth(signal)
        if (!controller.signal.aborted) setHealth({ status: 'online' })
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        const message =
          error instanceof ApiError
            ? error.message
            : 'We couldn’t reach the document service. Check that your backend is running and try again.'
        setHealth({ status: 'offline', message })
      }
    }

    void checkConnection()
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setHealth({ status: 'checking' })
    setAttempt((previous) => previous + 1)
  }

  const checking = health.status === 'checking'
  const online = health.status === 'online'

  return (
    <section
      className="overflow-hidden rounded-[18px] border border-panel-border bg-surface shadow-panel"
      aria-labelledby="connection-heading"
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-[26px] py-[22px] max-[600px]:p-[18px]">
        <h2 className="text-[13px] font-semibold" id="connection-heading">
          Document service
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-[20px] px-[9px] py-[5px] text-[10px] font-semibold ${healthStyles[health.status]}`}
        >
          <span
            className="size-[5px] rounded-full bg-current"
            aria-hidden="true"
          />
          {checking ? 'Checking' : online ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div
        className="px-[26px] pt-8 pb-9 max-[600px]:px-[18px] max-[600px]:py-[26px]"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div
          className={`mb-[18px] grid size-11 place-items-center rounded-full [&_svg]:size-6 ${healthStyles[health.status]}`}
          aria-hidden="true"
        >
          {checking ? (
            <span className="size-[18px] animate-spin rounded-full border-[1.5px] border-[#ddcfb5] border-t-[#947548] motion-reduce:animate-none" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              {online ? (
                <path d="m6 12 4 4 8-8" />
              ) : (
                <path d="m8 8 8 8M16 8l-8 8" />
              )}
            </svg>
          )}
        </div>
        <h3 className="mb-2 text-xl font-[550] tracking-[-0.5px] max-[600px]:text-lg">
          {checking
            ? 'Making the connection…'
            : online
              ? 'Everything is connected.'
              : 'Let’s reconnect.'}
        </h3>
        <p className="max-w-[430px] text-[13px] leading-[1.8] text-muted">
          {checking
            ? 'Checking that your workspace can reach the document service.'
            : online
              ? 'Your frontend can talk to the backend. The foundation for your vault is ready.'
              : health.message}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-rule bg-panel-footer px-[26px] py-4 max-[600px]:p-[18px]">
        <span className="text-[10px] leading-normal text-muted max-[600px]:max-w-[150px]">
          Connection checks don’t use AI credits.
        </span>
        <Button onClick={retry} disabled={checking}>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M15.5 7a6 6 0 1 0 .3 5M15.5 3.5V7H12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
    </section>
  )
}
