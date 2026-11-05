import { describe, expect, it } from 'vitest'
import { canAskDocument } from './status'

describe('canAskDocument', () => {
  it.each(['embedded', 'ready'])(
    'allows questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(true)
    },
  )
  it.each(['queued', 'processing', 'extracted', 'failed'])(
    'blocks questions for %s documents',
    (status) => {
      expect(canAskDocument(status)).toBe(false)
    },
  )
})
