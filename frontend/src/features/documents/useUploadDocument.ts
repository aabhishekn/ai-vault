import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { uploadDocument } from './upload'
import type { VaultDocument } from './types'

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; document: VaultDocument }
  | { status: 'error'; message: string }

export function useUploadDocument(onUploaded: () => void) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => () => activeRequest.current?.abort(), [])

  function reset() {
    if (!activeRequest.current) setState({ status: 'idle' })
  }

  async function upload(file: File): Promise<boolean> {
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
    } catch (error: unknown) {
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
