import { describe, expect, it } from 'vitest'

import { friendlyErrorMessage } from './errorMessages'

describe('friendlyErrorMessage', () => {
  describe('string inputs', () => {
    it('tells the user they lack permission when the raw error is EACCES', () => {
      // Arrange
      const rawError = 'EACCES: permission denied, open /file'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe("You don't have permission to do this.")
    })

    it('tells the user the target is gone when the raw error is ENOENT', () => {
      // Arrange
      const rawError = 'ENOENT: no such file or directory'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('The file or folder no longer exists.')
    })

    it('tells the user the name is taken when the raw error is EEXIST', () => {
      // Arrange
      const rawError = 'EEXIST: file already exists'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('A file with this name already exists.')
    })

    it('tells the user the disk is full when the raw error is ENOSPC', () => {
      // Arrange
      const rawError = 'ENOSPC: no space left on device'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Not enough disk space.')
    })

    it('tells the user to retry when the raw error is ETIMEDOUT', () => {
      // Arrange
      const rawError = 'ETIMEDOUT: connection timed out'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('The operation timed out. Please try again.')
    })

    it('tells the user to check their connection when the raw error is ENOTFOUND', () => {
      // Arrange
      const rawError = 'ENOTFOUND: dns lookup failed'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Could not connect. Check your internet connection.')
    })

    it('falls back to the generic message for an unrecognized error string', () => {
      // Arrange
      const rawError = 'some unknown error'
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })

    it('falls back to the generic message for an empty error string', () => {
      // Arrange
      const rawError = ''
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })
  })

  describe('Error object inputs', () => {
    it('maps an EACCES Error object to the no-permission message', () => {
      // Arrange
      const rawError = new Error('EACCES: permission denied')
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe("You don't have permission to do this.")
    })

    it('maps an ENOENT Error object to the missing-target message', () => {
      // Arrange
      const rawError = new Error('ENOENT: no such file')
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('The file or folder no longer exists.')
    })

    it('falls back to the generic message for an Error object with an unknown message', () => {
      // Arrange
      const rawError = new Error('unexpected failure')
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })
  })

  describe('non-string, non-Error inputs', () => {
    it('falls back to the generic message for null', () => {
      // Arrange
      const rawError = null
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })

    it('falls back to the generic message for undefined', () => {
      // Arrange
      const rawError = undefined
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })

    it('falls back to the generic message for a number', () => {
      // Arrange
      const rawError = 42
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })

    it('falls back to the generic message for an object that carries no error code', () => {
      // Arrange
      const rawError = { code: 'UNKNOWN' }
      // Act
      const message = friendlyErrorMessage(rawError)
      // Assert
      expect(message).toBe('Something went wrong. Please try again.')
    })
  })
})
