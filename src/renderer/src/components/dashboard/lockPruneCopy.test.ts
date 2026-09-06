import { describe, expect, test } from 'vitest'

import { describeLockPruneTarget } from './lockPruneCopy'

describe('describeLockPruneTarget', () => {
  test('reads as one skill throughout when a single record is up for deletion', () => {
    // Arrange
    const count = 1

    // Act
    const copy = describeLockPruneTarget(count)

    // Assert
    expect(copy).toEqual({
      subject: 'a skill that is',
      recordNoun: 'record',
      recordVerb: 'is',
      pronoun: 'it',
      confirmLabel: 'Remove 1 record',
    })
  })

  test('agrees in the plural across the sentence and the button for several records', () => {
    // Arrange
    const count = 3

    // Act
    const copy = describeLockPruneTarget(count)

    // Assert
    expect(copy).toEqual({
      subject: '3 skills that are',
      recordNoun: 'records',
      recordVerb: 'are',
      pronoun: 'them',
      confirmLabel: 'Remove 3 records',
    })
  })

  test('stays plural at zero so an empty dialog never reads as one skill', () => {
    // Arrange
    // The dialog opens on whatever the scan found; a race can leave it empty,
    // and "a skill that is no longer installed" would then be a lie.
    const count = 0

    // Act
    const copy = describeLockPruneTarget(count)

    // Assert
    expect(copy).toEqual({
      subject: '0 skills that are',
      recordNoun: 'records',
      recordVerb: 'are',
      pronoun: 'them',
      confirmLabel: 'Remove 0 records',
    })
  })
})
