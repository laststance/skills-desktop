import { describe, expect, it } from 'vitest'

import { errorCode, isMissingPathError } from './errorCode'

/**
 * Build a Node-style filesystem error for cleanup safety tests.
 * @param code - Errno code attached to the error object.
 * @param message - Human-readable fs error text, including the path.
 * @returns Error with a Node `code` field.
 * @example makeFsError('ENOENT', 'missing').code // => 'ENOENT'
 */
function makeFsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

describe('errorCode', () => {
  it('surfaces the Node errno string so catch blocks can branch on ENOENT', () => {
    // Arrange
    const renameFailure = makeFsError('ENOENT', 'no such file or directory')

    // Act
    const result = errorCode(renameFailure)

    // Assert
    expect(result).toBe('ENOENT')
  })

  it('reports no code when the caught value is null so callers rethrow instead of misclassifying', () => {
    // Arrange
    const thrownNull = null

    // Act
    const result = errorCode(thrownNull)

    // Assert
    expect(result).toBeUndefined()
  })

  it('reports no code when a bare string is thrown so non-Error throws are not parsed', () => {
    // Arrange
    const thrownString = 'ENOENT: this is just a message, not an Error'

    // Act
    const result = errorCode(thrownString)

    // Assert
    expect(result).toBeUndefined()
  })

  it('reports no code when the error object lacks a code field so unrelated errors fall through', () => {
    // Arrange
    const codelessError = new Error('boom without a code property')

    // Act
    const result = errorCode(codelessError)

    // Assert
    expect(result).toBeUndefined()
  })

  it('reports no code when the code field is a non-string so numeric codes are ignored', () => {
    // Arrange
    const numericCodeError = Object.assign(new Error('numeric code'), {
      code: 13,
    })

    // Act
    const result = errorCode(numericCodeError)

    // Assert
    expect(result).toBeUndefined()
  })
})

describe('isMissingPathError', () => {
  it('treats only missing-path errno codes as cleanup-safe missing targets', () => {
    // Arrange
    const missingFile = makeFsError('ENOENT', 'missing')
    const missingParent = makeFsError('ENOTDIR', 'parent is not a directory')

    // Act + Assert
    expect(isMissingPathError(missingFile)).toBe(true)
    expect(isMissingPathError(missingParent)).toBe(true)
  })

  it('does not parse ENOENT text from an inaccessible path message', () => {
    // Arrange
    const inaccessible = makeFsError(
      'EACCES',
      "EACCES: permission denied, access '/tmp/ENOENT-locked-skill'",
    )

    // Act
    const result = isMissingPathError(inaccessible)

    // Assert
    expect(result).toBe(false)
  })
})
