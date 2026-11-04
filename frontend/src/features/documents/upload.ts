import { ApiError, requestJson } from '../../lib/api'
import { isDocument } from './api'
import type { VaultDocument } from './types'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function validateUpload(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Choose a PDF file.'
  if (file.name.length > 255)
    return 'Use a filename with at most 255 characters.'
  if (file.size === 0) return 'This file is empty. Choose a PDF with content.'
  if (file.size > MAX_UPLOAD_BYTES)
    return 'Choose a PDF that is 10 MB or smaller (10,485,760 bytes).'
  return null
}

const unconfirmedUpload =
  'We couldn’t confirm the upload. Refresh the document list before uploading again; the file may already be saved.'

export async function uploadDocument(
  file: File,
  signal: AbortSignal,
): Promise<VaultDocument> {
  const validationError = validateUpload(file)
  if (validationError) throw new ApiError(validationError)
  const body = new FormData()
  body.append('file', file)
  try {
    // Let the browser set the multipart boundary; do not set Content-Type.
    const data = await requestJson('/documents', signal, {
      method: 'POST',
      body,
    })
    if (!isDocument(data)) throw new ApiError(unconfirmedUpload)
    return data
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 413)
        throw new ApiError(
          'Choose a PDF that is 10 MB or smaller (10,485,760 bytes).',
        )
      if (error.status === 415)
        throw new ApiError(
          'This file is not a supported PDF. Choose a valid PDF file.',
        )
      if (error.status === 400 || error.status === 422)
        throw new ApiError(
          'The file was rejected. Check that it is a nonempty PDF with a filename of at most 255 characters.',
        )
    }
    // A timeout or queue failure can happen after the document has been saved.
    throw new ApiError(unconfirmedUpload)
  }
}
