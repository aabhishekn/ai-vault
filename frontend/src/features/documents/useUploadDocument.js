import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { uploadDocument } from './upload'

export function useUploadDocument(onUploaded) {
  const [state, setState] = useState({ status: 'idle' })
  const activeRequest = useRef(null)
  useEffect(() => () => activeRequest.current?.abort(), [])

  function reset() {
    if (!activeRequest.current) setState({ status: 'idle' })
  }

  async function upload(file) {
    if (activeRequest.current) return false
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'uploading' })
    try {
      const document = await uploadDocument(
        file,
        AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      )
      if (controller.signal.aborted) return false
      setState({ status: 'success', document })
      onUploaded()
      return true
    } catch (error) {
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
