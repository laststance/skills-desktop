import { describe, expect, it } from 'vitest'

import {
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
} from '@/shared/settings'

import { IPC_ARG_SCHEMAS } from './ipc-schemas'

const directoryIdentity = {
  kind: 'directory' as const,
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

/**
 * Runtime validation tests for IPC boundary schemas.
 *
 * These schemas are the trust boundary between the renderer (compromised-by-
 * default in threat modeling) and the main process (filesystem/network
 * access). A regression here can turn a bug in the renderer into a
 * sandbox escape.
 */

describe('path-traversal skill names blocked on every skill-name-accepting channel', () => {
  // The same refined string is used by every skill-name-accepting channel;
  // a regression in one place would undermine the overall boundary. This
  // test asserts the uniformity explicitly — if someone adds a new channel
  // and forgets to use skillNameString, this will not catch it directly
  // but the `../` rejections above will (all channels share the refinement).
  it('blocks a path-traversal skill name ("../etc/passwd") on every skill-name-accepting channel', () => {
    // Arrange
    const malicious = '../etc/passwd'

    // Act / Assert — each channel must reject the traversal name independently.
    expect(
      IPC_ARG_SCHEMAS['skills:unlinkFromAgent']!.safeParse([
        {
          skillName: malicious,
          agentId: 'cursor',
          linkPath: '/tmp/x',
          targetPath: '/tmp/target',
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:deleteSkill']!.safeParse([
        {
          skillName: malicious,
          skillPath: '/tmp/x',
          filesystemIdentity: directoryIdentity,
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:deleteSkills']!.safeParse([
        {
          items: [
            {
              skillName: malicious,
              skillPath: '/tmp/x',
              filesystemIdentity: directoryIdentity,
            },
          ],
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:createSymlinks']!.safeParse([
        {
          skillName: malicious,
          skillPath: '/tmp/x',
          agentIds: ['cursor'],
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:copyToAgents']!.safeParse([
        {
          skillName: malicious,
          sourcePath: '/tmp/x',
          targetAgentIds: ['cursor'],
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:clearOrphanSymlinks']!.safeParse([
        {
          items: [
            {
              skillName: malicious,
              agents: [
                {
                  agentId: 'cursor',
                  linkPath: '/tmp/link',
                  targetPath: '/tmp/target',
                },
              ],
            },
          ],
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:clearBrokenSymlinkSlots']!.safeParse([
        {
          items: [
            {
              agentId: 'cursor',
              linkName: malicious,
              linkPath: '/tmp/link',
              targetPath: '/tmp/target',
            },
          ],
        },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['skills:unlinkManyFromAgent']!.safeParse([
        {
          agentId: 'cursor',
          items: [
            {
              skillName: malicious,
              linkPath: '/tmp/link',
              targetPath: '/tmp/target',
            },
          ],
        },
      ]).success,
    ).toBe(false)
  })
})

describe('cleanup IPC target path schemas', () => {
  const orphanSchema = IPC_ARG_SCHEMAS['skills:clearOrphanSymlinks']!
  const brokenSchema = IPC_ARG_SCHEMAS['skills:clearBrokenSymlinkSlots']!

  it('rejects orphan cleanup records that omit or relativize the reviewed target path', () => {
    // Arrange / Act / Assert — a missing targetPath is rejected.
    expect(
      orphanSchema.safeParse([
        {
          items: [
            {
              skillName: 'abandoned',
              agents: [
                {
                  agentId: 'cursor',
                  linkPath: '/tmp/link',
                },
              ],
            },
          ],
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — a relative targetPath is rejected.
    expect(
      orphanSchema.safeParse([
        {
          items: [
            {
              skillName: 'abandoned',
              agents: [
                {
                  agentId: 'cursor',
                  linkPath: '/tmp/link',
                  targetPath: 'relative/target',
                },
              ],
            },
          ],
        },
      ]).success,
    ).toBe(false)
  })

  it('rejects broken-slot cleanup records that omit or relativize the reviewed target path', () => {
    // Arrange / Act / Assert — a missing targetPath is rejected.
    expect(
      brokenSchema.safeParse([
        {
          items: [
            {
              agentId: 'cursor',
              linkName: 'task',
              linkPath: '/tmp/link',
            },
          ],
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — a relative targetPath is rejected.
    expect(
      brokenSchema.safeParse([
        {
          items: [
            {
              agentId: 'cursor',
              linkName: 'task',
              linkPath: '/tmp/link',
              targetPath: 'relative/target',
            },
          ],
        },
      ]).success,
    ).toBe(false)
  })
})

describe('reviewed destructive path schemas', () => {
  const unlinkSchema = IPC_ARG_SCHEMAS['skills:unlinkFromAgent']!
  const deleteSchema = IPC_ARG_SCHEMAS['skills:deleteSkill']!
  const deleteBatchSchema = IPC_ARG_SCHEMAS['skills:deleteSkills']!

  it('requires an absolute linkPath for single-agent unlink', () => {
    // Arrange
    const payload = {
      skillName: 'task',
      agentId: 'cursor',
      linkPath: 'relative/link',
      targetPath: '/tmp/target',
    }

    // Act
    const result = unlinkSchema.safeParse([payload])

    // Assert
    expect(result.success).toBe(false)
  })

  it('requires targetPath for single-agent symlink unlink', () => {
    // Arrange
    const missingTargetPath = {
      skillName: 'task',
      agentId: 'cursor',
      linkPath: '/tmp/task',
    }
    const relativeTargetPath = {
      skillName: 'task',
      agentId: 'cursor',
      linkPath: '/tmp/task',
      targetPath: 'relative/target',
    }
    const validSymlinkUnlink = {
      skillName: 'task',
      agentId: 'cursor',
      linkPath: '/tmp/task',
      targetPath: '/tmp/target',
    }

    // Act / Assert
    expect(unlinkSchema.safeParse([missingTargetPath]).success).toBe(false)
    expect(unlinkSchema.safeParse([relativeTargetPath]).success).toBe(false)
    expect(unlinkSchema.safeParse([validSymlinkUnlink]).success).toBe(true)
  })

  it('requires reviewed identity for confirmed single-agent local delete', () => {
    // Arrange
    const missingIdentity = {
      skillName: 'local-task',
      agentId: 'cursor',
      linkPath: '/tmp/local-task',
      confirmedLocalDirectoryDelete: true,
    }
    const validLocalDelete = {
      skillName: 'local-task',
      agentId: 'cursor',
      linkPath: '/tmp/local-task',
      confirmedLocalDirectoryDelete: true,
      reviewedDirectoryIdentity: directoryIdentity,
    }

    // Act / Assert
    expect(unlinkSchema.safeParse([missingIdentity]).success).toBe(false)
    expect(unlinkSchema.safeParse([validLocalDelete]).success).toBe(true)
  })

  it('requires a reviewed filesystem identity for single delete', () => {
    // Arrange
    const payload = {
      skillName: 'task',
      skillPath: '/tmp/task',
    }

    // Act
    const result = deleteSchema.safeParse([payload])

    // Assert
    expect(result.success).toBe(false)
  })

  it('requires a reviewed filesystem identity for batch delete items', () => {
    // Arrange
    const payload = {
      items: [{ skillName: 'task', skillPath: '/tmp/task' }],
    }

    // Act
    const result = deleteBatchSchema.safeParse([payload])

    // Assert
    expect(result.success).toBe(false)
  })
})

describe('destructive reviewed-path IPC schemas', () => {
  const singleDeleteSchema = IPC_ARG_SCHEMAS['skills:deleteSkill']!
  const batchDeleteSchema = IPC_ARG_SCHEMAS['skills:deleteSkills']!
  const batchUnlinkSchema = IPC_ARG_SCHEMAS['skills:unlinkManyFromAgent']!

  it('accepts an absolute skillPath for delete but rejects a missing or relative one (single and batch)', () => {
    // Act / Assert — single delete without a skillPath is rejected.
    expect(singleDeleteSchema.safeParse([{ skillName: 'task' }]).success).toBe(
      false,
    )
    // Act / Assert — single delete with a relative skillPath is rejected.
    expect(
      singleDeleteSchema.safeParse([
        {
          skillName: 'task',
          skillPath: 'relative/path',
          filesystemIdentity: directoryIdentity,
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — batch delete without a skillPath is rejected.
    expect(
      batchDeleteSchema.safeParse([{ items: [{ skillName: 'task' }] }]).success,
    ).toBe(false)
    // Act / Assert — batch delete with a relative skillPath is rejected.
    expect(
      batchDeleteSchema.safeParse([
        {
          items: [
            {
              skillName: 'task',
              skillPath: 'relative/path',
              filesystemIdentity: directoryIdentity,
            },
          ],
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — batch delete with an absolute skillPath is accepted.
    expect(
      batchDeleteSchema.safeParse([
        {
          items: [
            {
              skillName: 'task',
              skillPath: '/tmp/task',
              filesystemIdentity: directoryIdentity,
            },
          ],
        },
      ]).success,
    ).toBe(true)
  })

  it('accepts an absolute linkPath and target for bulk unlink but rejects a missing or relative one', () => {
    // Act / Assert — bulk unlink without a linkPath is rejected.
    expect(
      batchUnlinkSchema.safeParse([
        { agentId: 'cursor', items: [{ skillName: 'task' }] },
      ]).success,
    ).toBe(false)
    // Act / Assert — a relative linkPath is rejected.
    expect(
      batchUnlinkSchema.safeParse([
        {
          agentId: 'cursor',
          items: [
            {
              skillName: 'task',
              linkPath: 'relative/path',
              targetPath: '/tmp/target',
            },
          ],
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — a relative targetPath is rejected.
    expect(
      batchUnlinkSchema.safeParse([
        {
          agentId: 'cursor',
          items: [
            {
              skillName: 'task',
              linkPath: '/tmp/task',
              targetPath: 'relative/target',
            },
          ],
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — absolute linkPath and targetPath are accepted.
    expect(
      batchUnlinkSchema.safeParse([
        {
          agentId: 'cursor',
          items: [
            {
              skillName: 'task',
              linkPath: '/tmp/task',
              targetPath: '/tmp/target',
            },
          ],
        },
      ]).success,
    ).toBe(true)
  })

  it('accepts remove-all only with an absolute agent path AND a reviewed directory identity', () => {
    // Arrange
    const removeAllSchema = IPC_ARG_SCHEMAS['skills:removeAllFromAgent']!

    // Act / Assert — a relative agentPath is rejected.
    expect(
      removeAllSchema.safeParse([
        { agentId: 'cursor', agentPath: 'relative/path' },
      ]).success,
    ).toBe(false)
    // Act / Assert — an absolute agentPath without a reviewed identity is rejected.
    expect(
      removeAllSchema.safeParse([
        { agentId: 'cursor', agentPath: '/tmp/.cursor/skills' },
      ]).success,
    ).toBe(false)
    // Act / Assert — an absolute agentPath plus a reviewed identity is accepted.
    expect(
      removeAllSchema.safeParse([
        {
          agentId: 'cursor',
          agentPath: '/tmp/.cursor/skills',
          filesystemIdentity: directoryIdentity,
        },
      ]).success,
    ).toBe(true)
  })
})

/**
 * Argument validation for the folder:* channels added in the
 * "Open in Terminal / Reveal in Finder" feature. These schemas guard the
 * boundary between an untrusted renderer call and `shell.openPath` /
 * `child_process.spawn('open', ...)`.
 */
describe('folder:* channels', () => {
  const finderSchema = IPC_ARG_SCHEMAS['folder:revealInFinder']!
  const terminalSchema = IPC_ARG_SCHEMAS['folder:openInTerminal']!

  it('lets Reveal in Finder run on an absolute folder path', () => {
    // Arrange
    const absolutePath = '/Users/me/.agents/skills'

    // Act / Assert
    expect(finderSchema.safeParse([absolutePath]).success).toBe(true)
  })

  it('blocks Reveal in Finder on an empty path at the IPC boundary', () => {
    // Arrange
    const emptyPath = ''

    // Act / Assert
    expect(finderSchema.safeParse([emptyPath]).success).toBe(false)
  })

  it('blocks Reveal in Finder on a relative path at the IPC boundary', () => {
    // Arrange
    const relativePath = 'relative/path'

    // Act / Assert
    expect(finderSchema.safeParse([relativePath]).success).toBe(false)
  })

  it('guards Open in Terminal with the same absolute-path-only rule', () => {
    // Act / Assert — an absolute path is accepted.
    expect(terminalSchema.safeParse(['/Users/me/.cline/skills']).success).toBe(
      true,
    )
    // Act / Assert — an empty path is rejected.
    expect(terminalSchema.safeParse(['']).success).toBe(false)
    // Act / Assert — a relative path is rejected.
    expect(terminalSchema.safeParse(['./relative']).success).toBe(false)
  })
})

/**
 * `settings:set` is the highest-blast-radius write channel: validated input
 * lands on disk in user data. The schema is .strict() so unknown keys are
 * rejected — a compromised renderer cannot inject arbitrary fields.
 */
describe('settings:set lockstep with SettingsSchema', () => {
  const schema = IPC_ARG_SCHEMAS['settings:set']!

  it('lets the user persist a preferredTerminal choice', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ preferredTerminal: 'iterm' }]).success).toBe(
      true,
    )
  })

  it('lets the user persist a custom terminal app name within the length cap', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ customTerminalAppName: 'Hyper' }]).success).toBe(
      true,
    )
  })

  it('lets the user persist a window background blur radius within bounds', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ windowBackgroundBlurRadius: 24 }]).success).toBe(
      true,
    )
  })

  it('lets the user persist the auto-download updates toggle', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ autoDownloadUpdates: true }]).success).toBe(true)
  })

  it('blocks a non-boolean auto-download toggle from reaching disk', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ autoDownloadUpdates: 'yes' }]).success).toBe(
      false,
    )
  })

  it('blocks an unknown terminal preset from reaching disk', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ preferredTerminal: 'fish-shell' }]).success,
    ).toBe(false)
  })

  it('blocks a custom terminal app name longer than the 64-char cap', () => {
    // Arrange
    const overlongName = 'a'.repeat(65)

    // Act / Assert
    expect(
      schema.safeParse([{ customTerminalAppName: overlongName }]).success,
    ).toBe(false)
  })

  it('blocks an out-of-range or fractional window background blur radius', () => {
    // Act / Assert — below the allowed minimum is rejected.
    expect(
      schema.safeParse([
        {
          windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MIN_RADIUS - 1,
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — a fractional radius is rejected.
    expect(
      schema.safeParse([{ windowBackgroundBlurRadius: 24.5 }]).success,
    ).toBe(false)
    // Act / Assert — above the allowed maximum is rejected.
    expect(
      schema.safeParse([
        {
          windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1,
        },
      ]).success,
    ).toBe(false)
  })

  it('blocks an unknown extra settings key (.strict()) from a compromised renderer', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ defaultSkillTab: 'files', somethingElse: 'x' }])
        .success,
    ).toBe(false)
  })

  it('does not wipe a persisted hiddenAgentIds when an unrelated setting is saved', () => {
    // Arrange
    // Regression for the wipe-on-every-write bug: when the IPC schema for
    // `hiddenAgentIds` chained `.optional()` over the disk schema's
    // `.default([])`, every settings:set call that omitted the key
    // materialized `hiddenAgentIds: []` in the parsed output, which then
    // clobbered the persisted value via `{ ...current, ...partial }` in
    // saveSettings(). Pin this so the IPC schema can never re-inherit a
    // default.

    // Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('hiddenAgentIds' in parsed[0]).toBe(false)
  })

  it('does not wipe a persisted window blur radius when an unrelated setting is saved', () => {
    // Arrange / Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('windowBackgroundBlurRadius' in parsed[0]).toBe(false)
  })

  it('does not wipe a persisted auto-download opt-in when an unrelated setting is saved', () => {
    // Arrange
    // Same wipe-on-every-write guard as hiddenAgentIds/blur: the IPC schema
    // declares the toggle as a bare `z.boolean().optional()` rather than
    // chaining `.optional()` over the disk schema's `.default(false)`. If it
    // re-inherited the default, every unrelated settings:set would parse to
    // `{ autoDownloadUpdates: false }` and clobber a user's persisted opt-in.

    // Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('autoDownloadUpdates' in parsed[0]).toBe(false)
  })

  it('lets the user persist an explicit hiddenAgentIds list', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ hiddenAgentIds: ['claude-code'] }]).success,
    ).toBe(true)
  })

  it('blocks an unknown agent id in hiddenAgentIds from a compromised renderer', () => {
    // Arrange
    // The renderer should never emit a non-AgentId. Disk reads are
    // forgiving (drop stale ids); the IPC channel is strict.

    // Act / Assert
    expect(
      schema.safeParse([{ hiddenAgentIds: ['definitely-not-an-agent'] }])
        .success,
    ).toBe(false)
  })

  it('blocks an oversized hiddenAgentIds payload longer than the agent roster', () => {
    // Arrange
    // Defense-in-depth payload cap — a misbehaving renderer cannot push
    // an arbitrarily long list past the IPC boundary. Every legitimate
    // entry beyond AGENT_IDS.length would have to be a duplicate anyway.
    const oversized = Array.from({ length: 100 }, () => 'claude-code' as const)

    // Act / Assert
    expect(schema.safeParse([{ hiddenAgentIds: oversized }]).success).toBe(
      false,
    )
  })
})
