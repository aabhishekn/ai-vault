import { ApiError, requestJson } from '../../../lib/api'

export const LENGTHS = ['short', 'medium', 'long']
export const TONES = ['neutral', 'formal', 'casual', 'executive']
export const MAX_FOCUS_LENGTH = 200

export function titleCase(value) {
  return value[0]?.toUpperCase() + value.slice(1)
}

// The chosen options in a few words, such as "Short · Formal · Focus: risks".
export function describeOptions({ length, tone, focus }) {
  const parts = [titleCase(length), titleCase(tone)]
  if (focus.trim()) parts.push(`Focus: ${focus.trim()}`)
  return parts.join(' · ')
}

export const DEFAULT_OPTIONS = {
  length: 'medium',
  tone: 'neutral',
  focus: '',
}

function toError(error) {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return new ApiError(
        'This document could not be found. Close this view and refresh the document list.',
      )
    if (error.status === 409)
      return new ApiError(
        'Document text is not ready yet. Try again once processing finishes.',
      )
    if (error.status === 413)
      return new ApiError('This document is too long for a custom summary.')
    if (error.status === 422)
      return new ApiError('Those summary options were not accepted.')
    if (error.status === 429)
      return new ApiError(
        'Too many AI requests right now. Wait a moment and try again.',
      )
    if (error.status === undefined) return error
  }
  return new ApiError(
    'We couldn’t write that summary. Check your connection and try again.',
  )
}

export async function generateCustomSummary(id, options, signal) {
  try {
    const data = await requestJson(
      `/documents/${encodeURIComponent(id)}/summary/custom`,
      signal,
      {
        method: 'POST',
        json: {
          length: options.length,
          tone: options.tone,
          focus: options.focus.trim() || null,
        },
      },
    )
    if (
      typeof data !== 'object' ||
      data === null ||
      !('document_id' in data) ||
      data.document_id !== id ||
      !('summary' in data) ||
      typeof data.summary !== 'string' ||
      !data.summary.trim() ||
      !('cached' in data) ||
      typeof data.cached !== 'boolean'
    )
      throw new ApiError(
        'The document service returned an unexpected summary. Please try again.',
      )
    return { summary: data.summary, cached: data.cached }
  } catch (error) {
    throw toError(error)
  }
}
