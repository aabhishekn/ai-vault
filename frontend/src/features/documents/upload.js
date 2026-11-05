import { ApiError, requestJson } from '../../lib/api'
import { isDocument } from './api'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

// PDFs, plus pictures that the server reads as a scanned page.
export const UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const SUPPORTED_NAME = /\.(pdf|png|jpe?g)$/i

export function validateUpload(file) {
  if (!SUPPORTED_NAME.test(file.name)) return 'Choose a PDF, PNG or JPG file.'
  if (file.name.length > 255)
    return 'Use a filename with at most 255 characters.'
  if (file.size === 0) return 'This file is empty. Choose a file with content.'
  if (file.size > MAX_UPLOAD_BYTES)
    return 'Choose a file that is 10 MB or smaller (10,485,760 bytes).'
  return null
}

const unconfirmedUpload =
  'We couldn’t confirm the upload. Refresh the document list before uploading again; the file may already be saved.'

async function postFile(path, file, signal, conflictMessage) {
  const validationError = validateUpload(file)
  if (validationError) throw new ApiError(validationError)
  const body = new FormData()
  body.append('file', file)
  try {
    // Let the browser set the multipart boundary; do not set Content-Type.
    const data = await requestJson(path, signal, { method: 'POST', body })
    if (!isDocument(data)) throw new ApiError(unconfirmedUpload)
    return data
  } catch (error) {
    if (error instanceof ApiError) {
      const custom = error.status ? conflictMessage?.(error.status) : null
      if (custom) throw new ApiError(custom)
      if (error.status === 413)
        throw new ApiError(
          'Choose a file that is 10 MB or smaller (10,485,760 bytes).',
        )
      if (error.status === 415)
        throw new ApiError(
          'This file is not a supported type. Choose a valid PDF, PNG or JPG file.',
        )
      if (error.status === 400 || error.status === 422)
        throw new ApiError(
          'The file was rejected. Check that it is a nonempty PDF, PNG or JPG with a filename of at most 255 characters.',
        )
    }
    // A timeout or queue failure can happen after the document has been saved.
    throw new ApiError(unconfirmedUpload)
  }
}

export function uploadDocument(file, signal) {
  return postFile('/documents', file, signal)
}

export function uploadNewVersion(documentId, file, signal) {
  return postFile(
    `/documents/${encodeURIComponent(documentId)}/versions`,
    file,
    signal,
    (status) => {
      if (status === 404)
        return 'This document could not be found. Close this view and refresh the list.'
      if (status === 409)
        return 'This file is identical to the current version, or another version was just uploaded. Check the version list and try again.'
      if (status === 429)
        return 'Too many uploads right now. Wait a moment and try again.'
      return null
    },
  )
}
