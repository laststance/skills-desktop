import { describe, expect, it } from 'vitest'

import { isMissingPathError } from './errorCode'

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
