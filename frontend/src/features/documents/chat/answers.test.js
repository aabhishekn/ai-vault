import { describe, expect, it } from 'vitest'
import { validateQuestion } from './answers'

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
})
