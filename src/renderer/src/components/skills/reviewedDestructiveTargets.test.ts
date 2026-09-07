import { describe, expect, it } from 'vitest'

import type {
  FilesystemEntryIdentity,
  Skill,
  SymlinkInfo,
} from '@/shared/types'
import {
  toAbsolutePath,
  toFileSizeBytes,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

import {
  buildAgentUnlinkTargets,
  partitionGlobalDeleteTargets,
} from './reviewedDestructiveTargets'

/**
 * Build a Skill row with a single agent symlink slot for unlink fixtures.
 * @param name - Display name selected in the confirmation dialog.
 * @param symlinks - Per-agent slots the reviewed scan captured.
 * @returns A minimal Skill shaped for buildAgentUnlinkTargets.
 * @example makeSkill('task', [{ agentId: 'cursor', ... }])
 */
function makeSkill(name: string, symlinks: SymlinkInfo[]): Skill {
  return {
    name: toSkillName(name),
    description: 'desc',
    path: toAbsolutePath('/Users/me/.agents/skills/task'),
    symlinkCount: toSymlinkCount(0),
    symlinks,
    isSource: true,
    isOrphan: false,
  }
}

describe('buildAgentUnlinkTargets', () => {
  it('builds a reviewed unlink target from the agent slot that has both link and target paths', () => {
    // Arrange — a skill whose cursor slot is a real symlink with a resolvable target
    const skills: Skill[] = [
      makeSkill('task', [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/Users/me/.cursor/skills/task'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/task'),
          isLocal: false,
        },
      ]),
    ]

    // Act
    const result = buildAgentUnlinkTargets(
      skills,
      [toSkillName('task')],
      'cursor',
    )

    // Assert
    expect(result.targets).toEqual([
      {
        skillName: 'task',
        linkPath: '/Users/me/.cursor/skills/task',
        targetPath: '/Users/me/.agents/skills/task',
      },
    ])
    expect(result.staleNames).toEqual([])
  })

  it('marks a selected skill stale when its agent slot lost its target path between scan and confirm', () => {
    // Arrange — the cursor slot exists but its symlink target vanished (missing),
    // so targetPath is undefined and the row can no longer be unlinked safely.
    const skills: Skill[] = [
      makeSkill('task', [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'missing',
          linkPath: toAbsolutePath('/Users/me/.cursor/skills/task'),
          isLocal: false,
        },
      ]),
    ]

    // Act
    const result = buildAgentUnlinkTargets(
      skills,
      [toSkillName('task')],
      'cursor',
    )

    // Assert — no unlink target produced; the name is flagged for a rescan
    expect(result.targets).toEqual([])
    expect(result.staleNames).toEqual(['task'])
  })

  it('marks a selected skill stale when it has no slot for the chosen agent', () => {
    // Arrange — the skill is only linked to codex, but the dialog targets cursor
    const skills: Skill[] = [
      makeSkill('task', [
        {
          agentId: 'codex',
          agentName: 'Codex',
          status: 'valid',
          linkPath: toAbsolutePath('/Users/me/.codex/skills/task'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/task'),
          isLocal: false,
        },
      ]),
    ]

    // Act
    const result = buildAgentUnlinkTargets(
      skills,
      [toSkillName('task')],
      'cursor',
    )

    // Assert
    expect(result.targets).toEqual([])
    expect(result.staleNames).toEqual(['task'])
  })

  it('marks a selected skill stale when its row is no longer present in the reviewed scan', () => {
    // Arrange — the selected name is absent from the current skill rows entirely
    const skills: Skill[] = []

    // Act
    const result = buildAgentUnlinkTargets(
      skills,
      [toSkillName('vanished')],
      'cursor',
    )

    // Assert
    expect(result.targets).toEqual([])
    expect(result.staleNames).toEqual(['vanished'])
  })
})

describe('partitionGlobalDeleteTargets — protected names', () => {
  it('routes a protected skill to protectedErrors and excludes it from delete targets', () => {
    // Arrange — a normal source skill selected for deletion, but locked by the user.
    const sourceSkill: Skill = {
      name: toSkillName('task'),
      description: 'desc',
      path: toAbsolutePath('/Users/me/.agents/skills/task'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }

    // Act
    const result = partitionGlobalDeleteTargets(
      [sourceSkill],
      [toSkillName('task')],
      new Set([toSkillName('task')]),
    )

    // Assert — protected skill is in protectedErrors, not deleteTargets
    expect(result.protectedErrors).toEqual([
      {
        skillName: 'task',
        outcome: 'error',
        error: {
          code: 'EPROTECTED',
          message: 'Skill is protected. Unlock it before deleting.',
        },
      },
    ])
    expect(result.deleteTargets).toEqual([])
    expect(result.orphanRecords).toEqual([])
    expect(result.staleDeleteErrors).toEqual([])
    expect(result.orphanErrors).toEqual([])
  })

  it('routes a protected orphan skill to protectedErrors and bypasses the orphan cleanup path', () => {
    // Arrange — an orphan skill (isOrphan=true) that the user has locked.
    // The orphan check runs after the protected check, so a locked orphan
    // must never reach orphan-cleanup records.
    const orphanSkill: Skill = {
      name: toSkillName('abandoned'),
      description: 'desc',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'codex',
          agentName: 'Codex',
          status: 'broken',
          linkPath: toAbsolutePath('/Users/me/.codex/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: true,
    }

    // Act
    const result = partitionGlobalDeleteTargets(
      [orphanSkill],
      [toSkillName('abandoned')],
      new Set([toSkillName('abandoned')]),
    )

    // Assert — protection intercepts before orphan path
    expect(result.protectedErrors).toHaveLength(1)
    expect(result.protectedErrors[0].skillName).toBe('abandoned')
    expect(result.orphanRecords).toEqual([])
    expect(result.orphanErrors).toEqual([])
  })

  it('only routes the locked skill to protectedErrors when deleting a mixed batch', () => {
    // Arrange — two skills selected; only one is locked. The unlocked skill must
    // have filesystemIdentity so partitionGlobalDeleteTargets routes it to
    // deleteTargets rather than staleDeleteErrors.
    const identity: FilesystemEntryIdentity = {
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: toFileSizeBytes(96),
      ctimeMs: 3,
      mtimeMs: 4,
    }
    const skills: Skill[] = [
      {
        name: toSkillName('locked'),
        description: 'desc',
        path: toAbsolutePath('/Users/me/.agents/skills/locked'),
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('unlocked'),
        description: 'desc',
        path: toAbsolutePath('/Users/me/.agents/skills/unlocked'),
        filesystemIdentity: identity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]

    // Act
    const result = partitionGlobalDeleteTargets(
      skills,
      [toSkillName('locked'), toSkillName('unlocked')],
      new Set([toSkillName('locked')]),
    )

    // Assert — only the locked skill is skipped; unlocked proceeds to deleteTargets
    expect(result.protectedErrors).toHaveLength(1)
    expect(result.protectedErrors[0].skillName).toBe('locked')
    expect(result.deleteTargets).toHaveLength(1)
    expect(result.deleteTargets[0].skillName).toBe('unlocked')
  })
})

describe('partitionGlobalDeleteTargets', () => {
  it('cleans up only the dangling non-local agent symlink and ignores a local folder slot and a missing slot of the same orphan', () => {
    // Arrange — an orphan skill (source dir gone) with three differently-shaped
    // slots: a broken non-local symlink that still readlinks to a target
    // (the only safe orphan-cleanup slot), a real local folder masquerading as
    // the same skill name (isLocal true), and a broken slot whose target
    // vanished (targetPath undefined). Only the first should be cleaned up.
    const orphanSkill: Skill = {
      name: toSkillName('abandoned'),
      description: 'desc',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'codex',
          agentName: 'Codex',
          status: 'broken',
          linkPath: toAbsolutePath('/Users/me/.codex/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          isLocal: false,
        },
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/Users/me/.cursor/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          isLocal: true,
        },
        {
          agentId: 'claude-code',
          agentName: 'Claude Code',
          status: 'broken',
          linkPath: toAbsolutePath('/Users/me/.claude/skills/abandoned'),
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: true,
    }
    const skills: Skill[] = [orphanSkill]

    // Act
    const result = partitionGlobalDeleteTargets(skills, [
      toSkillName('abandoned'),
    ])

    // Assert — exactly one reviewed orphan record holding only the codex slot;
    // the local-folder slot and the targetless slot are filtered out, and no
    // stale/orphan errors are produced because a valid cleanup slot exists.
    expect(result.orphanRecords).toEqual([
      {
        skillName: 'abandoned',
        agents: [
          {
            agentId: 'codex',
            linkPath: '/Users/me/.codex/skills/abandoned',
            targetPath: '/Users/me/.agents/skills/abandoned',
          },
        ],
      },
    ])
    expect(result.orphanErrors).toEqual([])
    expect(result.deleteTargets).toEqual([])
    expect(result.staleDeleteErrors).toEqual([])
  })
})
