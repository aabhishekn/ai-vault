import { describe, expect, it } from 'vitest'
import { canAskDocument, validateQuestion } from './answers'

describe('document question rules', () => {
  it.each(['', '  ', 'x'.repeat(2001)])(
    'rejects invalid question %#',
    (invalid) => {
      expect(validateQuestion(invalid)).not.toBeNull()
    },
  )
  it('accepts the 2,000-character boundary', () => {
    expect(validateQuestion('x'.repeat(2000))).toBeNull()
  })
  it.each(['embedded', 'ready'] as const)(
    'allows questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(true)
    },
  )
  it.each(['queued', 'processing', 'extracted', 'failed'] as const)(
    'blocks questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(false)
    },
  )
})
