import { useEffect, useRef, useState } from 'react'
import {
  generateCustomSummary,
  type CustomSummary,
  type SummaryOptions,
} from './customSummaryApi'

type State =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'success'; data: CustomSummary }
  | { status: 'error'; message: string }

export function useCustomSummary(id: string) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => active.current?.abort(), [])

  async function generate(options: SummaryOptions) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setState({ status: 'generating' })
    try {
      const data = await generateCustomSummary(
        id,
        options,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      )
      if (!controller.signal.aborted) setState({ status: 'success', data })
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Summary failed.',
        })
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  return { state, generate }
}
