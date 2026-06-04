import { describe, expect, it } from 'vitest'

import type { PerSkillCopyOutcome } from '@/shared/types'

import { summarizeBulkCopyResult } from './summarizeBulkCopyResult'

describe('summarizeBulkCopyResult', () => {
  it('reports success and lists the copied skills when every target succeeds', () => {
    // Arrange
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 2, failures: [] },
      { skillName: 'beta', copied: 2, failures: [] },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill)

    // Assert
    expect(content).toEqual({
      tone: 'success',
      title: 'Copied 2 skills to 2 agents',
      description: 'alpha, beta',
    })
  })

  it('uses singular wording for one skill copied to one agent', () => {
    // Arrange
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 1, failures: [] },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill)

    // Assert
    expect(content).toEqual({
      tone: 'success',
      title: 'Copied 1 skill to 1 agent',
      description: 'alpha',
    })
  })

  it('warns and lists the per-target failures when some copies fail', () => {
    // Arrange
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 1, failures: [] },
      {
        skillName: 'beta',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill)

    // Assert
    expect(content).toEqual({
      tone: 'warning',
      title: 'Copied 1 of 2 skills, 1 copy failed',
      description: 'beta → codex: Already exists',
    })
  })

  it('reports a hard error when nothing was copied to any agent', () => {
    // Arrange
    const perSkill: PerSkillCopyOutcome[] = [
      {
        skillName: 'alpha',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Failed to copy 1 skill',
      description: 'alpha → codex: Already exists',
    })
  })

  it('returns an error for an empty result instead of a misleading success', () => {
    // Arrange
    const perSkill: PerSkillCopyOutcome[] = []

    // Act
    const content = summarizeBulkCopyResult(perSkill)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Nothing to copy',
      description: 'No skills were selected.',
    })
  })
})
