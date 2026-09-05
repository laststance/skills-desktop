import { describe, expect, it } from 'vitest'

import { getHiddenAgentsDeleteNotices } from './getHiddenAgentsDeleteNotices'

describe('Hidden agents deletion exclusions', () => {
  it('omits exclusion notices when every folder and skill is eligible', () => {
    // Arrange
    const skippedCount = 0
    const protectedCount = 0
    // Act
    const notices = getHiddenAgentsDeleteNotices(skippedCount, protectedCount)
    // Assert
    expect(notices).toEqual([])
  })

  it('explains a single skipped agent without implying protected entries exist', () => {
    // Arrange
    const skippedCount = 1
    const protectedCount = 0
    // Act
    const notices = getHiddenAgentsDeleteNotices(skippedCount, protectedCount)
    // Assert
    expect(notices).toEqual([
      '1 hidden agent with shared or unavailable folders will be skipped.',
    ])
  })

  it('explains a protected entry without implying shared folders were skipped', () => {
    // Arrange
    const skippedCount = 0
    const protectedCount = 1
    // Act
    const notices = getHiddenAgentsDeleteNotices(skippedCount, protectedCount)
    // Assert
    expect(notices).toEqual(['1 protected skill entry will be kept.'])
  })

  it('explains both exclusions with plural labels when multiple entries are kept', () => {
    // Arrange
    const skippedCount = 2
    const protectedCount = 3
    // Act
    const notices = getHiddenAgentsDeleteNotices(skippedCount, protectedCount)
    // Assert
    expect(notices).toEqual([
      '2 hidden agents with shared or unavailable folders will be skipped.',
      '3 protected skill entries will be kept.',
    ])
  })
})
