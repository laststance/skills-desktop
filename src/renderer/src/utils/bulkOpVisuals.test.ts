// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { toSkillName } from '@/shared/types'

import { flashFailedRows, getFlashEndsAt } from './bulkOpVisuals'

afterEach(() => {
  vi.restoreAllMocks()
})

// The registry is module state, so each test flashes its own skill names.
describe('failed-row flash registry', () => {
  test('keeps an earlier row flashing when a second batch fails before its flash ends', () => {
    // Arrange
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    flashFailedRows([toSkillName('alpha')])
    nowSpy.mockReturnValue(11_000)

    // Act
    flashFailedRows([toSkillName('beta')])

    // Assert
    expect(getFlashEndsAt(toSkillName('alpha'))).toBe(13_000)
    expect(getFlashEndsAt(toSkillName('beta'))).toBe(14_000)
  })

  test('reports no flash for a row whose flash ended before a later batch failed', () => {
    // Arrange
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(20_000)
    flashFailedRows([toSkillName('gamma')])
    nowSpy.mockReturnValue(24_000)

    // Act
    flashFailedRows([toSkillName('delta')])

    // Assert
    expect(getFlashEndsAt(toSkillName('gamma'))).toBeNull()
  })
})
