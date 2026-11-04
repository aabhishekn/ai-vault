import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { uploadDocument } from './upload'

// `handlers` are optional: onStarted(file) as the request goes out, then exactly one of
// onUploaded(document) or onFailed() when it ends.
export function useUploadDocument(handlers = {}) {
  const [state, setState] = useState({ status: 'idle' })
  const activeRequest = useRef(null)
  // The upload outlives the render that started it; call the handlers as they are now.
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => () => activeRequest.current?.abort(), [])

  function reset() {
    if (!activeRequest.current) setState({ status: 'idle' })
  }

  async function upload(file) {
    if (activeRequest.current) return false
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'uploading' })
    latest.current.onStarted?.(file)
    try {
      const document = await uploadDocument(
        file,
        AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      )
      if (controller.signal.aborted) return false
      setState({ status: 'success', document })
      latest.current.onUploaded?.(document)
      return true
    } catch (error) {
      latest.current.onFailed?.()
      if (!controller.signal.aborted) {
        setState({
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'The upload could not be confirmed. Refresh the list before trying again.',
        })
      }
      return false
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  return { state, upload, reset }
}
