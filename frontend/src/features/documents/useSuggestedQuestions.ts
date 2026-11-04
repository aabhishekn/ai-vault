import { useEffect, useRef, useState } from 'react'
import { getSuggestedQuestions } from './suggestions'

const TIMEOUT_MS = 60_000

export function useSuggestedQuestions(documentId: string) {
  const [questions, setQuestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => active.current?.abort(), [])

  async function suggest() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setLoading(true)
    setError(null)
    try {
      const result = await getSuggestedQuestions(
        documentId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      )
      if (!controller.signal.aborted) setQuestions(result)
    } catch (caught: unknown) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error ? caught.message : 'Suggestions failed.',
        )
    } finally {
      if (active.current === controller) active.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return { questions, loading, error, suggest }
}
