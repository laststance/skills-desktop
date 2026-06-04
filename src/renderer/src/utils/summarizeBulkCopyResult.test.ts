import { describe, expect, it } from 'vitest'

import type { PerSkillCopyOutcome } from '@/shared/types'

import { summarizeBulkCopyResult } from './summarizeBulkCopyResult'

describe('summarizeBulkCopyResult', () => {
  it('reports success and lists the copied skills when every target succeeds', () => {
    // Arrange — two skills, each copied to both ticked agents
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 2, failures: [] },
      { skillName: 'beta', copied: 2, failures: [] },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 2)

    // Assert
    expect(content).toEqual({
      tone: 'success',
      title: 'Copied 2 skills to 2 agents',
      description: 'alpha, beta',
    })
  })

  it('uses singular wording for one skill copied to one agent', () => {
    // Arrange — one skill, one ticked agent
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 1, failures: [] },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 1)

    // Assert
    expect(content).toEqual({
      tone: 'success',
      title: 'Copied 1 skill to 1 agent',
      description: 'alpha',
    })
  })

  it('warns and lists the per-target failures when some copies fail', () => {
    // Arrange — alpha lands on the one agent, beta collides on it
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 1, failures: [] },
      {
        skillName: 'beta',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 1)

    // Assert
    expect(content).toEqual({
      tone: 'warning',
      title: 'Copied 1 of 2 skills, 1 copy failed',
      description: 'beta → codex: Already exists',
    })
  })

  it('uses plural "copies" wording when several targets fail but some still copy', () => {
    // Arrange — alpha fully copies to both agents, beta collides on both
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 2, failures: [] },
      {
        skillName: 'beta',
        copied: 0,
        failures: [
          { agentId: 'codex', error: 'Already exists' },
          { agentId: 'cursor', error: 'Already exists' },
        ],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 2)

    // Assert
    expect(content).toEqual({
      tone: 'warning',
      title: 'Copied 1 of 2 skills, 2 copies failed',
      description:
        'beta → codex: Already exists, beta → cursor: Already exists',
    })
  })

  it('reports a hard error when nothing was copied to any agent', () => {
    // Arrange — the one skill collides on its one target
    const perSkill: PerSkillCopyOutcome[] = [
      {
        skillName: 'alpha',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 1)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Failed to copy 1 skill',
      description: 'alpha → codex: Already exists',
    })
  })

  it('reports a hard error listing every failure when nothing copies across multiple skills', () => {
    // Arrange — both skills collide on the same single target
    const perSkill: PerSkillCopyOutcome[] = [
      {
        skillName: 'alpha',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
      {
        skillName: 'beta',
        copied: 0,
        failures: [{ agentId: 'codex', error: 'Already exists' }],
      },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 1)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Failed to copy 2 skills',
      description:
        'alpha → codex: Already exists, beta → codex: Already exists',
    })
  })

  it('falls back to a generic error when nothing copied and no failures were reported', () => {
    // Arrange — defensive path: a skill came back copied:0 with no failure rows
    const perSkill: PerSkillCopyOutcome[] = [
      { skillName: 'alpha', copied: 0, failures: [] },
    ]

    // Act
    const content = summarizeBulkCopyResult(perSkill, 0)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Failed to copy 1 skill',
      description: 'An unexpected error occurred',
    })
  })

  it('returns an error for an empty result instead of a misleading success', () => {
    // Arrange — no skills selected
    const perSkill: PerSkillCopyOutcome[] = []

    // Act
    const content = summarizeBulkCopyResult(perSkill, 2)

    // Assert
    expect(content).toEqual({
      tone: 'error',
      title: 'Nothing to copy',
      description: 'No skills were selected.',
    })
  })
})
