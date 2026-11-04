import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { getHealth } from './api'
import './HealthCard.css'

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
    <section className="health-card" aria-labelledby="connection-heading">
      <div className="health-card-topline">
        <h2 id="connection-heading">Document service</h2>
        <span className={`health-badge health-badge--${health.status}`}>
          <span className="health-badge-dot" aria-hidden="true" />
          {checking ? 'Checking' : online ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div
        className="health-result"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div
          className={`health-symbol health-symbol--${health.status}`}
          aria-hidden="true"
        >
          {checking ? (
            <span className="health-spinner" />
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
        <h3>
          {checking
            ? 'Making the connection…'
            : online
              ? 'Everything is connected.'
              : 'Let’s reconnect.'}
        </h3>
        <p>
          {checking
            ? 'Checking that your workspace can reach the document service.'
            : online
              ? 'Your frontend can talk to the backend. The foundation for your vault is ready.'
              : health.message}
        </p>
      </div>

      <div className="health-card-footer">
        <span>Connection checks don’t use AI credits.</span>
        <button type="button" onClick={retry} disabled={checking}>
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
        </button>
      </div>
    </section>
  )
}
