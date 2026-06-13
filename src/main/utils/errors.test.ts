import { describe, expect, it } from 'vitest'

import { extractErrorMessage } from './errors'

describe('extractErrorMessage', () => {
  it('surfaces the underlying Error message so IPC catch blocks report the real failure', () => {
    // Arrange
    const diskFailure = new Error('disk full')

    // Act
    const result = extractErrorMessage(diskFailure)

    // Assert
    expect(result).toBe('disk full')
  })

  it('returns the caller-supplied fallback when a non-Error value is thrown so the UI shows a meaningful message', () => {
    // Arrange
    const thrownString = 'string error'

    // Act
    const result = extractErrorMessage(thrownString, 'Custom fallback')

    // Assert
    expect(result).toBe('Custom fallback')
  })

  it('falls back to the default message when an undefined non-Error is thrown so callers never get an empty string', () => {
    // Arrange
    const thrownUndefined = undefined

    // Act
    const result = extractErrorMessage(thrownUndefined)

    // Assert
    expect(result).toBe('Unknown error occurred')
  })
})
