import { describe, expect, test } from 'vitest'

import type {
  AgentId,
  AgentName,
  Skill,
  SkillName,
  SymlinkInfo,
  SymlinkStatus,
} from '@/shared/types'
import { toAbsolutePath, toSkillName, toSymlinkCount } from '@/shared/types'

import {
  buildSymlinkCleanupPlan,
  createBrokenSlotCleanupItemId,
  createOrphanCleanupItemId,
  getLinkNameFromPath,
  getSymlinkCleanupPlanItems,
} from './buildSymlinkCleanupPlan'

/**
 * Builds a SymlinkInfo fixture for plan-builder specs that need concrete per-agent slots.
 * @param overrides - Slot properties overridden by the current spec.
 * @returns SymlinkInfo suitable for a Skill fixture.
 * @example
 * makeSymlink({ status: 'broken' }).status // => 'broken'
 */
function makeSymlink(overrides: Partial<SymlinkInfo> = {}): SymlinkInfo {
  const agentId: AgentId = overrides.agentId ?? 'cursor'
  const agentName: AgentName = overrides.agentName ?? 'Cursor'
  const status: SymlinkStatus = overrides.status ?? 'valid'
  const linkName = overrides.linkPath?.split('/').pop() ?? 'task'

  return {
    agentId,
    agentName,
    status,
    targetPath: toAbsolutePath(
      overrides.targetPath ?? `/Users/test/.agents/skills/${linkName}`,
    ),
    linkPath: toAbsolutePath(
      overrides.linkPath ?? `/Users/test/.cursor/skills/${linkName}`,
    ),
    isLocal: overrides.isLocal ?? false,
  }
}

/**
 * Builds a Skill fixture whose symlinkCount matches its valid slots.
 * @param overrides - Skill fields overridden by the current spec.
 * @returns Skill fixture for cleanup-plan unit tests.
 * @example
 * makeSkill({ name: 'browser' }).name // => 'browser'
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const name: SkillName = toSkillName(overrides.name ?? 'task')
  const symlinks = overrides.symlinks ?? [makeSymlink()]

  return {
    name,
    description: `${name} description`,
    path: toAbsolutePath(
      overrides.path ?? `/Users/test/.agents/skills/${name}`,
    ),
    symlinkCount: toSymlinkCount(
      symlinks.filter((symlink) => symlink.status === 'valid').length,
    ),
    symlinks,
    isSource: overrides.isSource ?? true,
    isOrphan: overrides.isOrphan ?? false,
    source: overrides.source,
    sourceUrl: overrides.sourceUrl,
  }
}

describe('buildSymlinkCleanupPlan', () => {
  test('shows no cleanup items when every symlink slot is valid', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: toSkillName('healthy'),
        symlinks: [makeSymlink({ status: 'valid' })],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(getSymlinkCleanupPlanItems(plan)).toEqual([])
    expect(plan.totals).toEqual({
      orphanRecords: 0,
      orphanSymlinks: 0,
      brokenSlots: 0,
      affectedAgents: 0,
    })
  })

  test('classifies an orphan skill with broken symlinks as one orphan record', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: toSkillName('abandoned'),
        path: toAbsolutePath('/Users/test/.cursor/skills/abandoned'),
        isSource: false,
        isOrphan: true,
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'broken',
            linkPath: toAbsolutePath('/Users/test/.cursor/skills/abandoned'),
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            linkPath: toAbsolutePath('/Users/test/.codex/skills/abandoned'),
          }),
        ],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(plan.orphanRecords).toEqual([
      {
        id: 'orphan:abandoned',
        kind: 'orphan-record',
        skillName: 'abandoned',
        agents: [
          {
            agentId: 'cursor',
            agentName: 'Cursor',
            linkPath: '/Users/test/.cursor/skills/abandoned',
            targetPath: '/Users/test/.agents/skills/abandoned',
          },
          {
            agentId: 'codex',
            agentName: 'Codex',
            linkPath: '/Users/test/.codex/skills/abandoned',
            targetPath: '/Users/test/.agents/skills/abandoned',
          },
        ],
        symlinkCount: 2,
      },
    ])
    expect(plan.totals).toEqual({
      orphanRecords: 1,
      orphanSymlinks: 2,
      brokenSlots: 0,
      affectedAgents: 2,
    })
  })

  test('classifies a non-orphan broken symlink as a broken agent link', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: toSkillName('metadata-title'),
        path: toAbsolutePath('/Users/test/.agents/skills/metadata-title'),
        isOrphan: false,
        symlinks: [
          makeSymlink({
            status: 'broken',
            linkPath: toAbsolutePath(
              '/Users/test/.cursor/skills/link-folder-name',
            ),
            targetPath: toAbsolutePath(
              '/Users/test/.agents/skills/missing-target',
            ),
          }),
        ],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(plan.brokenSlotsByAgent.cursor).toEqual([
      {
        id: 'broken:cursor:link-folder-name',
        kind: 'broken-slot',
        displaySkillName: 'metadata-title',
        linkName: 'link-folder-name',
        preservedSkillPath: '/Users/test/.agents/skills/metadata-title',
        agentId: 'cursor',
        agentName: 'Cursor',
        linkPath: '/Users/test/.cursor/skills/link-folder-name',
        targetPath: '/Users/test/.agents/skills/missing-target',
      },
    ])
    expect(plan.totals).toEqual({
      orphanRecords: 0,
      orphanSymlinks: 0,
      brokenSlots: 1,
      affectedAgents: 1,
    })
  })

  test('ignores missing and local slots so coverage gaps are not cleaned', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: toSkillName('mixed'),
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'missing',
            linkPath: toAbsolutePath('/Users/test/.cursor/skills/mixed'),
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            isLocal: true,
            linkPath: toAbsolutePath('/Users/test/.codex/skills/mixed'),
          }),
          makeSymlink({
            agentId: 'devin',
            agentName: 'Devin for Terminal',
            status: 'inaccessible',
            linkPath: toAbsolutePath('/Users/test/.config/devin/skills/mixed'),
          }),
        ],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(getSymlinkCleanupPlanItems(plan)).toEqual([])
  })

  test('keeps same skill broken in two agents as independently selectable rows', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: toSkillName('task'),
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'broken',
            linkPath: toAbsolutePath('/Users/test/.cursor/skills/task'),
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            linkPath: toAbsolutePath('/Users/test/.codex/skills/task'),
          }),
        ],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(getSymlinkCleanupPlanItems(plan).map((item) => item.id)).toEqual([
      'broken:cursor:task',
      'broken:codex:task',
    ])
  })

  test('escapes cleanup id segments so separators cannot collide', () => {
    // Arrange
    const agentId = 'cursor' as AgentId
    const linkName = toSkillName('name:with/slash')

    // Act
    const itemId = createBrokenSlotCleanupItemId(agentId, linkName)

    // Assert
    expect(itemId).toBe('broken:cursor:name%3Awith%2Fslash')
  })

  test('keeps orphan cleanup id literals stable for persisted row state', () => {
    // Arrange
    const skillName = toSkillName('name:with/slash')

    // Act
    const itemId = createOrphanCleanupItemId(skillName)

    // Assert
    expect(itemId).toBe('orphan:name%3Awith%2Fslash')
  })
})

describe('getLinkNameFromPath', () => {
  test('uses the final agent-side path segment as the unlink name', () => {
    // Arrange
    const linkPath = '/Users/test/.cursor/skills/link-folder-name'

    // Act
    const linkName = getLinkNameFromPath(toAbsolutePath(linkPath))

    // Assert
    expect(linkName).toBe('link-folder-name')
  })

  test('returns the raw path when it has no nameable final segment', () => {
    // Arrange
    const linkPath = toAbsolutePath('/')

    // Act
    const linkName = getLinkNameFromPath(linkPath)

    // Assert
    expect(linkName).toBe('/')
  })
})
