import { describe, expect, test } from 'vitest'

import type { SkillName, UnprunableLockEntry } from '@/shared/types'

import {
  describeLockPruneTarget,
  describeUnprunableReason,
  describeUnprunableSection,
  selectRemovableNames,
} from './lockPruneCopy'

describe('describeLockPruneTarget', () => {
  test('keeps every word singular when exactly one record is up for deletion', () => {
    // Arrange
    const count = 1

    // Act
    const copy = describeLockPruneTarget(count)

    // Assert
    expect(copy).toEqual({
      subject: '1 record for a skill',
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
      subject: '3 records for skills',
      recordNoun: 'records',
      recordVerb: 'are',
      pronoun: 'them',
      confirmLabel: 'Remove 3 records',
    })
  })

  test('stays plural at zero so an empty dialog never reads as a single record', () => {
    // Arrange
    // The dialog opens on whatever the scan found; a race can leave it empty,
    // and "1 record for a skill" would then be a lie.
    const count = 0

    // Act
    const copy = describeLockPruneTarget(count)

    // Assert
    expect(copy).toEqual({
      subject: '0 records for skills',
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

describe('selectRemovableNames', () => {
  test('drops a consented name the scan blocked while the dialog was open', () => {
    // Arrange — the record the user read is still in the snapshot, but a scan
    // has since found an agent copy behind it.
    const consentedNames = ['plain-stale', 'agent-copy-skill'] as SkillName[]
    const unprunableEntries: UnprunableLockEntry[] = [
      { name: 'agent-copy-skill', reason: 'agent-copy' },
    ]

    // Act
    const removable = selectRemovableNames(consentedNames, unprunableEntries)

    // Assert
    expect(removable).toEqual(['plain-stale'])
  })

  test('sends every consented name when the scan blocked none of them', () => {
    // Arrange
    const consentedNames = ['one', 'two'] as SkillName[]

    // Act
    const removable = selectRemovableNames(consentedNames, [])

    // Assert
    expect(removable).toEqual(['one', 'two'])
  })

  test('sends nothing when every consented name turned out to be blocked', () => {
    // Arrange — the dialog still has to render, as pure explanation.
    const consentedNames = ['collided', 'agent-copy-skill'] as SkillName[]
    const unprunableEntries: UnprunableLockEntry[] = [
      { name: 'collided', reason: 'name-collision' },
      { name: 'agent-copy-skill', reason: 'agent-copy' },
    ]

    // Act
    const removable = selectRemovableNames(consentedNames, unprunableEntries)

    // Assert
    expect(removable).toEqual([])
  })

  test('ignores a blocked record that was never in the consent snapshot', () => {
    // Arrange — the scan reports the whole lock; the dialog only ever deletes
    // what the user actually read.
    const consentedNames = ['plain-stale'] as SkillName[]
    const unprunableEntries: UnprunableLockEntry[] = [
      { name: 'never-shown', reason: 'agent-copy' },
    ]

    // Act
    const removable = selectRemovableNames(consentedNames, unprunableEntries)

    // Assert
    expect(removable).toEqual(['plain-stale'])
  })
})
