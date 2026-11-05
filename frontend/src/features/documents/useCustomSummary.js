import { useEffect, useRef, useState } from 'react'
import { generateCustomSummary } from './customSummaryApi'

export function useCustomSummary(id) {
  const [state, setState] = useState({ status: 'idle' })
  const active = useRef(null)

  useEffect(() => () => active.current?.abort(), [])

  async function generate(options) {
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
      if (controller.signal.aborted) return null
      setState({ status: 'success', data })
      return data
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Summary failed.',
        })
      return null
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  return { state, generate }
}
