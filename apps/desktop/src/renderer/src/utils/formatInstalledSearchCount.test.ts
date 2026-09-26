import { describe, expect, test } from 'vitest'

import { formatInstalledSearchCount } from './formatInstalledSearchCount'

describe('formatInstalledSearchCount', () => {
  test('reads "1 skill" when exactly one skill is visible', () => {
    // Arrange
    const visibleSkillCount = 1

    // Act
    const countText = formatInstalledSearchCount(visibleSkillCount)

    // Assert
    expect(countText).toBe('1 skill')
  })

  test('reads "37 skills" for a multi-skill list', () => {
    // Arrange
    const visibleSkillCount = 37

    // Act
    const countText = formatInstalledSearchCount(visibleSkillCount)

    // Assert
    expect(countText).toBe('37 skills')
  })

  test('reads "0 skills" when a search matches nothing', () => {
    // Arrange
    const visibleSkillCount = 0

    // Act
    const countText = formatInstalledSearchCount(visibleSkillCount)

    // Assert
    expect(countText).toBe('0 skills')
  })
})
