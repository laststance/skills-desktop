import { describe, expect, test } from 'vitest'

import {
  describeLockPruneTarget,
  describeUnprunableReason,
  describeUnprunableSection,
} from './lockPruneCopy'

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

describe('describeUnprunableReason', () => {
  test('tells a user with a name collision that removing either record is the risk', () => {
    // Arrange
    const reason = 'name-collision' as const

    // Act
    const explanation = describeUnprunableReason(reason)

    // Assert
    expect(explanation).toBe(
      'Another lock record maps to the same folder, so removing either one could remove the wrong record.',
    )
  })

  test('warns that an agent-held folder would be deleted with the record', () => {
    // Arrange
    // This is the one the user most needs stated plainly: the CLI would rm -rf
    // real files under ~/.claude/skills, not just drop a lock entry.
    const reason = 'agent-copy' as const

    // Act
    const explanation = describeUnprunableReason(reason)

    // Assert
    expect(explanation).toBe(
      'An agent holds a real folder under this name, not a link — removing the record would delete that folder with it.',
    )
  })
})

describe('describeUnprunableSection', () => {
  test('agrees with its verb for a single blocked record', () => {
    // Arrange
    const count = 1

    // Act
    const heading = describeUnprunableSection(count)

    // Assert
    expect(heading).toBe('1 record needs attention first')
  })

  test('agrees with its verb for several blocked records', () => {
    // Arrange
    const count = 4

    // Act
    const heading = describeUnprunableSection(count)

    // Assert
    expect(heading).toBe('4 records need attention first')
  })
})
