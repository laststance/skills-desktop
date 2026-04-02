import { describe, expect, it } from 'vitest'

import { friendlyErrorMessage } from './errorMessages'

describe('friendlyErrorMessage', () => {
  describe('string inputs', () => {
    it('returns permission denied for EACCES string', () => {
      expect(
        friendlyErrorMessage('EACCES: permission denied, open /file'),
      ).toBe("You don't have permission to do this.")
    })

    it('returns file not found for ENOENT string', () => {
      expect(friendlyErrorMessage('ENOENT: no such file or directory')).toBe(
        'The file or folder no longer exists.',
      )
    })

    it('returns file exists for EEXIST string', () => {
      expect(friendlyErrorMessage('EEXIST: file already exists')).toBe(
        'A file with this name already exists.',
      )
    })

    it('returns no disk space for ENOSPC string', () => {
      expect(friendlyErrorMessage('ENOSPC: no space left on device')).toBe(
        'Not enough disk space.',
      )
    })

    it('returns timed out for ETIMEDOUT string', () => {
      expect(friendlyErrorMessage('ETIMEDOUT: connection timed out')).toBe(
        'The operation timed out. Please try again.',
      )
    })

    it('returns network error for ENOTFOUND string', () => {
      expect(friendlyErrorMessage('ENOTFOUND: dns lookup failed')).toBe(
        'Could not connect. Check your internet connection.',
      )
    })

    it('returns fallback for unrecognized string', () => {
      expect(friendlyErrorMessage('some unknown error')).toBe(
        'Something went wrong. Please try again.',
      )
    })

    it('returns fallback for empty string', () => {
      expect(friendlyErrorMessage('')).toBe(
        'Something went wrong. Please try again.',
      )
    })
  })

  describe('Error object inputs', () => {
    it('extracts message from Error with EACCES', () => {
      expect(friendlyErrorMessage(new Error('EACCES: permission denied'))).toBe(
        "You don't have permission to do this.",
      )
    })

    it('extracts message from Error with ENOENT', () => {
      expect(friendlyErrorMessage(new Error('ENOENT: no such file'))).toBe(
        'The file or folder no longer exists.',
      )
    })

    it('extracts message from Error with unknown message', () => {
      expect(friendlyErrorMessage(new Error('unexpected failure'))).toBe(
        'Something went wrong. Please try again.',
      )
    })
  })

  describe('non-string, non-Error inputs', () => {
    it('returns fallback for null', () => {
      expect(friendlyErrorMessage(null)).toBe(
        'Something went wrong. Please try again.',
      )
    })

    it('returns fallback for undefined', () => {
      expect(friendlyErrorMessage(undefined)).toBe(
        'Something went wrong. Please try again.',
      )
    })

    it('returns fallback for number', () => {
      expect(friendlyErrorMessage(42)).toBe(
        'Something went wrong. Please try again.',
      )
    })

    it('returns fallback for object without ENOENT', () => {
      expect(friendlyErrorMessage({ code: 'UNKNOWN' })).toBe(
        'Something went wrong. Please try again.',
      )
    })
  })
})
