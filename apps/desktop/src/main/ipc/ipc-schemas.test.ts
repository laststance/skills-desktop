import { describe, expect, test } from 'vitest'

import {
  CODE_FONT_SIZE_MAX_PX,
  CODE_FONT_SIZE_MIN_PX,
  MARKDOWN_FONT_SIZE_MAX_PX,
  MARKDOWN_FONT_SIZE_MIN_PX,
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
  test('blocks a path-traversal skill name ("../etc/passwd") on every skill-name-accepting channel', () => {
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

  test('rejects orphan cleanup records that omit or relativize the reviewed target path', () => {
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

  test('rejects broken-slot cleanup records that omit or relativize the reviewed target path', () => {
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

  test('requires an absolute linkPath for single-agent unlink', () => {
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

  test('requires targetPath for single-agent symlink unlink', () => {
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

  test('requires reviewed identity for confirmed single-agent local delete', () => {
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

  test('requires a reviewed filesystem identity for single delete', () => {
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

  test('requires a reviewed filesystem identity for batch delete items', () => {
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

  test('accepts an absolute skillPath for delete but rejects a missing or relative one (single and batch)', () => {
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
    // Act / Assert — single delete with an absolute skillPath is accepted.
    expect(
      singleDeleteSchema.safeParse([
        {
          skillName: 'task',
          skillPath: '/tmp/task',
          filesystemIdentity: directoryIdentity,
        },
      ]).success,
    ).toBe(true)
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

  test('accepts an absolute linkPath and target for bulk unlink but rejects a missing or relative one', () => {
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

  test('accepts remove-all only with an absolute agent path AND a reviewed directory identity', () => {
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
          protectedSkillPaths: ['/tmp/.cursor/skills/locked'],
        },
      ]).success,
    ).toBe(true)
    // Act / Assert — protected paths still must be absolute.
    expect(
      removeAllSchema.safeParse([
        {
          agentId: 'cursor',
          agentPath: '/tmp/.cursor/skills',
          filesystemIdentity: directoryIdentity,
          protectedSkillPaths: ['relative/locked'],
        },
      ]).success,
    ).toBe(false)
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

  test('lets Reveal in Finder run on an absolute folder path', () => {
    // Arrange
    const absolutePath = '/Users/me/.agents/skills'

    // Act / Assert
    expect(finderSchema.safeParse([absolutePath]).success).toBe(true)
  })

  test('blocks Reveal in Finder on an empty path at the IPC boundary', () => {
    // Arrange
    const emptyPath = ''

    // Act / Assert
    expect(finderSchema.safeParse([emptyPath]).success).toBe(false)
  })

  test('blocks Reveal in Finder on a relative path at the IPC boundary', () => {
    // Arrange
    const relativePath = 'relative/path'

    // Act / Assert
    expect(finderSchema.safeParse([relativePath]).success).toBe(false)
  })

  test('guards Open in Terminal with the same absolute-path-only rule', () => {
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

  test('carries a valid notification token without adding it to saved preferences', () => {
    // Arrange
    const args = [
      { windowBackgroundOpacityPercent: 85 },
      'bf6200f5-d5ce-42bb-8fcb-7e4dbd18bb73',
    ]
    // Act
    const parsed = schema.parse(args)
    // Assert
    expect(parsed).toEqual([
      { windowBackgroundOpacityPercent: 85 },
      'bf6200f5-d5ce-42bb-8fcb-7e4dbd18bb73',
    ])
  })

  test('rejects malformed notification tokens before saving settings', () => {
    // Arrange / Act / Assert
    for (const token of [null, 42, '', 'not-a-request-id']) {
      expect(schema.safeParse([{}, token]).success).toBe(false)
    }
  })

  test('accepts independent opacity settings while preserving the absence of unrelated fields', () => {
    // Arrange
    const patch = {
      windowOpacityMode: 'section',
      leftSectionOpacityPercent: 85,
    }
    // Act
    const parsed = schema.parse([patch])
    // Assert
    expect(parsed).toEqual([
      { windowOpacityMode: 'section', leftSectionOpacityPercent: 85 },
    ])
  })

  test('does not reset opacity preferences during an unrelated settings write', () => {
    // Arrange
    const patch = { codeFontSizePx: 16 }
    // Act
    const parsed = schema.parse([patch])
    // Assert
    expect(parsed).toEqual([{ codeFontSizePx: 16 }])
  })

  test.each([
    { leftSectionOpacityPercent: -1 },
    { centerSectionOpacityPercent: 101 },
    { rightSectionOpacityPercent: 65.5 },
    { windowOpacityMode: 'invalid' },
  ])(
    'refuses unsupported opacity values before writing settings: %j',
    (patch) => {
      // Arrange / Act
      const result = schema.safeParse([patch])
      // Assert
      expect(result.success).toBe(false)
    },
  )

  test('lets the user persist a preferredTerminal choice', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ preferredTerminal: 'iterm' }]).success).toBe(
      true,
    )
  })

  test('lets the user persist a custom terminal app name within the length cap', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ customTerminalAppName: 'Hyper' }]).success).toBe(
      true,
    )
  })

  test('lets the user persist a background opacity percentage within bounds', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ windowBackgroundOpacityPercent: 90 }]).success,
    ).toBe(true)
  })

  test('lets the user persist a Markdown reading font size within bounds', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ markdownFontSizePx: 18 }]).success).toBe(true)
  })

  test('lets the user persist a code preview font size within bounds', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ codeFontSizePx: 16 }]).success).toBe(true)
  })

  test('lets the user persist a curated code theme id', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ codeThemeId: 'catppuccin' }]).success).toBe(true)
  })

  test('lets the user persist the auto-download updates toggle', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ autoDownloadUpdates: true }]).success).toBe(true)
  })

  test('lets the user persist the Installed search count display placement', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ installedSearchCountDisplay: 'inline' }]).success,
    ).toBe(true)
    expect(
      schema.safeParse([{ installedSearchCountDisplay: 'tab' }]).success,
    ).toBe(true)
  })

  test('blocks a non-boolean auto-download toggle from reaching disk', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ autoDownloadUpdates: 'yes' }]).success).toBe(
      false,
    )
  })

  test('blocks an unknown Installed search count display placement from reaching disk', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ installedSearchCountDisplay: 'marketplace' }])
        .success,
    ).toBe(false)
  })

  test('blocks an unknown terminal preset from reaching disk', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ preferredTerminal: 'fish-shell' }]).success,
    ).toBe(false)
  })

  test('blocks a custom terminal app name longer than the 64-char cap', () => {
    // Arrange
    const overlongName = 'a'.repeat(65)

    // Act / Assert
    expect(
      schema.safeParse([{ customTerminalAppName: overlongName }]).success,
    ).toBe(false)
  })

  test('blocks an out-of-range or fractional background opacity percentage', () => {
    // Act / Assert — below the allowed minimum is rejected.
    expect(
      schema.safeParse([
        {
          windowBackgroundOpacityPercent: -1,
        },
      ]).success,
    ).toBe(false)
    // Act / Assert — a fractional percentage is rejected.
    expect(
      schema.safeParse([{ windowBackgroundOpacityPercent: 85.5 }]).success,
    ).toBe(false)
    // Act / Assert — above the allowed maximum is rejected.
    expect(
      schema.safeParse([
        {
          windowBackgroundOpacityPercent: 101,
        },
      ]).success,
    ).toBe(false)
  })

  test('blocks an out-of-range or fractional Markdown reading font size', () => {
    // Act / Assert — below the allowed minimum is rejected.
    expect(
      schema.safeParse([{ markdownFontSizePx: MARKDOWN_FONT_SIZE_MIN_PX - 1 }])
        .success,
    ).toBe(false)
    // Act / Assert — a fractional size is rejected.
    expect(schema.safeParse([{ markdownFontSizePx: 14.5 }]).success).toBe(false)
    // Act / Assert — above the allowed maximum is rejected.
    expect(
      schema.safeParse([{ markdownFontSizePx: MARKDOWN_FONT_SIZE_MAX_PX + 1 }])
        .success,
    ).toBe(false)
  })

  test('blocks an out-of-range or fractional code preview font size', () => {
    // Act / Assert — below the allowed minimum is rejected.
    expect(
      schema.safeParse([{ codeFontSizePx: CODE_FONT_SIZE_MIN_PX - 1 }]).success,
    ).toBe(false)
    // Act / Assert — a fractional size is rejected.
    expect(schema.safeParse([{ codeFontSizePx: 13.5 }]).success).toBe(false)
    // Act / Assert — above the allowed maximum is rejected.
    expect(
      schema.safeParse([{ codeFontSizePx: CODE_FONT_SIZE_MAX_PX + 1 }]).success,
    ).toBe(false)
  })

  test('blocks an unknown code theme id from reaching disk', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ codeThemeId: 'dracula' }]).success).toBe(false)
  })

  test('rejects the retired blur-radius setting at the IPC boundary', () => {
    // Arrange / Act / Assert
    expect(schema.safeParse([{ windowBackgroundBlurRadius: 24 }]).success).toBe(
      false,
    )
  })

  test('blocks an unknown extra settings key (.strict()) from a compromised renderer', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ defaultSkillTab: 'files', somethingElse: 'x' }])
        .success,
    ).toBe(false)
  })

  test('does not wipe a persisted hiddenAgentIds when an unrelated setting is saved', () => {
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

  test('does not wipe a persisted window background opacity percentage when an unrelated setting is saved', () => {
    // Arrange / Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('windowBackgroundOpacityPercent' in parsed[0]).toBe(false)
  })

  test('does not wipe a persisted Markdown reading font size when an unrelated setting is saved', () => {
    // Arrange
    // Same wipe-on-every-write guard as blur: the IPC schema declares the
    // size as a bare `.optional()` off the shared non-defaulting font schema
    // rather than chaining `.optional()` over the disk schema's
    // `.default(14)`. If it re-inherited the default, every unrelated
    // settings:set would parse to `{ markdownFontSizePx: 14 }` and reset a
    // user's chosen reading size.

    // Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('markdownFontSizePx' in parsed[0]).toBe(false)
  })

  test('does not wipe a persisted code preview font size when an unrelated setting is saved', () => {
    // Arrange / Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('codeFontSizePx' in parsed[0]).toBe(false)
  })

  test('does not wipe a persisted code theme choice when an unrelated setting is saved', () => {
    // Arrange / Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('codeThemeId' in parsed[0]).toBe(false)
  })

  test('does not wipe a persisted auto-download opt-in when an unrelated setting is saved', () => {
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

  test('does not wipe a persisted Installed search count placement when an unrelated setting is saved', () => {
    // Arrange / Act
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]

    // Assert
    expect('installedSearchCountDisplay' in parsed[0]).toBe(false)
  })

  test('lets the user persist an explicit hiddenAgentIds list', () => {
    // Arrange / Act / Assert
    expect(
      schema.safeParse([{ hiddenAgentIds: ['claude-code'] }]).success,
    ).toBe(true)
  })

  test('blocks an unknown agent id in hiddenAgentIds from a compromised renderer', () => {
    // Arrange
    // The renderer should never emit a non-AgentId. Disk reads are
    // forgiving (drop stale ids); the IPC channel is strict.

    // Act / Assert
    expect(
      schema.safeParse([{ hiddenAgentIds: ['definitely-not-an-agent'] }])
        .success,
    ).toBe(false)
  })

  test('blocks an oversized hiddenAgentIds payload longer than the agent roster', () => {
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

describe('theme:broadcast', () => {
  const validTheme = {
    hue: 195,
    chroma: 0.16,
    mode: 'dark' as const,
    modePreference: 'system' as const,
    preset: 'cyan',
  }

  test('relays a resolved theme that names a real preset', () => {
    // Arrange
    const schema = IPC_ARG_SCHEMAS['theme:broadcast']

    // Act
    const result = schema!.safeParse([validTheme])

    // Assert
    expect(result.success).toBe(true)
  })

  test('blocks a preset name that is not in THEME_PRESETS', () => {
    // Every window dispatches this payload straight into its theme reducer.
    // An unknown key would land on the reducer's stale-preset fallback and
    // silently reset the palette in a window the user never touched.
    // Arrange
    const schema = IPC_ARG_SCHEMAS['theme:broadcast']

    // Act
    const result = schema!.safeParse([{ ...validTheme, preset: 'mono-dark' }])

    // Assert
    expect(result.success).toBe(false)
  })

  test('blocks an out-of-range hue before it is written to a style property', () => {
    // `applyThemeToDOM` writes `hue` verbatim into `--theme-hue`, so the
    // OKLCH range is the only thing constraining it.
    // Arrange
    const schema = IPC_ARG_SCHEMAS['theme:broadcast']

    // Act
    const result = schema!.safeParse([{ ...validTheme, hue: 9999 }])

    // Assert
    expect(result.success).toBe(false)
  })

  test('blocks a mode outside light and dark', () => {
    // Arrange
    const schema = IPC_ARG_SCHEMAS['theme:broadcast']

    // Act
    const result = schema!.safeParse([{ ...validTheme, mode: 'sepia' }])

    // Assert
    expect(result.success).toBe(false)
  })

  test('blocks a key the theme contract does not declare', () => {
    // Strict rather than stripping: an extra key means the broadcasting
    // renderer and this schema have drifted, and a relay that fails loudly
    // beats one that quietly drops a field the receiving reducer expects.
    // Arrange
    const schema = IPC_ARG_SCHEMAS['theme:broadcast']

    // Act
    const result = schema!.safeParse([{ ...validTheme, accent: 'neon' }])

    // Assert
    expect(result.success).toBe(false)
  })
})
