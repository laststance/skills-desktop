import { describe, expect, test } from 'vitest'

import { getHiddenAgentsLabel } from './getHiddenAgentsLabel'

describe('Hidden agents disclosure', () => {
  test('hides the disclosure and overflow trigger when no installed agents are hidden', () => {
    // Arrange
    const hiddenAgentCount = 0
    // Act
    const label = getHiddenAgentsLabel(hiddenAgentCount)
    // Assert
    expect(label).toBeNull()
  })

  test('labels the disclosure with the number of hidden installed agents', () => {
    // Arrange
    const hiddenAgentCount = 3
    // Act
    const label = getHiddenAgentsLabel(hiddenAgentCount)
    // Assert
    expect(label).toBe('3 hidden')
  })
})
