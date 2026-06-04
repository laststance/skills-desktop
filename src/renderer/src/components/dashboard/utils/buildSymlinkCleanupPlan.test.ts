import { describe, expect, it } from 'vitest'

import type {
  AgentId,
  AgentName,
  Skill,
  SkillName,
  SymlinkInfo,
  SymlinkStatus,
} from '@/shared/types'

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
    targetPath:
      overrides.targetPath ?? `/Users/test/.agents/skills/${linkName}`,
    linkPath: overrides.linkPath ?? `/Users/test/.cursor/skills/${linkName}`,
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
  const name: SkillName = overrides.name ?? 'task'
  const symlinks = overrides.symlinks ?? [makeSymlink()]

  return {
    name,
    description: `${name} description`,
    path: overrides.path ?? `/Users/test/.agents/skills/${name}`,
    symlinkCount: symlinks.filter((symlink) => symlink.status === 'valid')
      .length,
    symlinks,
    isSource: overrides.isSource ?? true,
    isOrphan: overrides.isOrphan ?? false,
    source: overrides.source,
    sourceUrl: overrides.sourceUrl,
  }
}

describe('buildSymlinkCleanupPlan', () => {
  it('shows no cleanup items when every symlink slot is valid', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: 'healthy',
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

  it('classifies an orphan skill with broken symlinks as one orphan record', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: 'abandoned',
        path: '/Users/test/.cursor/skills/abandoned',
        isSource: false,
        isOrphan: true,
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'broken',
            linkPath: '/Users/test/.cursor/skills/abandoned',
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            linkPath: '/Users/test/.codex/skills/abandoned',
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

  it('classifies a non-orphan broken symlink as a broken agent link', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: 'metadata-title',
        path: '/Users/test/.agents/skills/metadata-title',
        isOrphan: false,
        symlinks: [
          makeSymlink({
            status: 'broken',
            linkPath: '/Users/test/.cursor/skills/link-folder-name',
            targetPath: '/Users/test/.agents/skills/missing-target',
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

  it('ignores missing and local slots so coverage gaps are not cleaned', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: 'mixed',
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'missing',
            linkPath: '/Users/test/.cursor/skills/mixed',
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            isLocal: true,
            linkPath: '/Users/test/.codex/skills/mixed',
          }),
          makeSymlink({
            agentId: 'devin',
            agentName: 'Devin for Terminal',
            status: 'inaccessible',
            linkPath: '/Users/test/.config/devin/skills/mixed',
          }),
        ],
      }),
    ]

    // Act
    const plan = buildSymlinkCleanupPlan(skills)

    // Assert
    expect(getSymlinkCleanupPlanItems(plan)).toEqual([])
  })

  it('keeps same skill broken in two agents as independently selectable rows', () => {
    // Arrange
    const skills = [
      makeSkill({
        name: 'task',
        symlinks: [
          makeSymlink({
            agentId: 'cursor',
            agentName: 'Cursor',
            status: 'broken',
            linkPath: '/Users/test/.cursor/skills/task',
          }),
          makeSymlink({
            agentId: 'codex',
            agentName: 'Codex',
            status: 'broken',
            linkPath: '/Users/test/.codex/skills/task',
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

  it('escapes cleanup id segments so separators cannot collide', () => {
    // Arrange
    const agentId = 'cursor' as AgentId
    const linkName = 'name:with/slash' as SkillName

    // Act
    const itemId = createBrokenSlotCleanupItemId(agentId, linkName)

    // Assert
    expect(itemId).toBe('broken:cursor:name%3Awith%2Fslash')
  })

  it('keeps orphan cleanup id literals stable for persisted row state', () => {
    // Arrange
    const skillName = 'name:with/slash' as SkillName

    // Act
    const itemId = createOrphanCleanupItemId(skillName)

    // Assert
    expect(itemId).toBe('orphan:name%3Awith%2Fslash')
  })
})

describe('getLinkNameFromPath', () => {
  it('uses the final agent-side path segment as the unlink name', () => {
    // Arrange
    const linkPath = '/Users/test/.cursor/skills/link-folder-name'

    // Act
    const linkName = getLinkNameFromPath(linkPath)

    // Assert
    expect(linkName).toBe('link-folder-name')
  })
})
