import { useEffect, useState } from 'react'
import { getQueueHealth } from './queue'

/**
 * The latest queue status, or null while unknown. A failed check also gives null: this
 * is a hint, so it must never show a warning it cannot back up.
 */
export function useQueueHealth(intervalMs = 30_000) {
  const [health, setHealth] = useState(null)
  useEffect(() => {
    const latest = { controller: null }
    async function check() {
      latest.controller?.abort()
      const current = new AbortController()
      latest.controller = current
      try {
        const result = await getQueueHealth(
          AbortSignal.any([current.signal, AbortSignal.timeout(10_000)]),
        )
        if (!current.signal.aborted) setHealth(result)
      } catch {
        if (!current.signal.aborted) setHealth(null)
      }
    }
    void check()
    const timer = setInterval(() => void check(), intervalMs)
    return () => {
      clearInterval(timer)
      latest.controller?.abort()
    }
  }, [intervalMs])
  return health
}
