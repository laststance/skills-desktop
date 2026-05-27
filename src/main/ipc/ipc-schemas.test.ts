import { describe, expect, it } from 'vitest'

import {
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
} from '@/shared/settings'

import { IPC_ARG_SCHEMAS } from './ipc-schemas'

/**
 * Runtime validation tests for IPC boundary schemas.
 *
 * These schemas are the trust boundary between the renderer (compromised-by-
 * default in threat modeling) and the main process (filesystem/network
 * access). A regression here can turn a bug in the renderer into a
 * sandbox escape.
 */

describe('skillNameString consistency across channels', () => {
  // The same refined string is used by every skill-name-accepting channel;
  // a regression in one place would undermine the overall boundary. This
  // test asserts the uniformity explicitly — if someone adds a new channel
  // and forgets to use skillNameString, this will not catch it directly
  // but the `../` rejections above will (all channels share the refinement).
  it('rejects "../etc/passwd" across every skill-name-accepting channel', () => {
    const channels: Array<keyof typeof IPC_ARG_SCHEMAS> = [
      'skills:unlinkFromAgent',
      'skills:deleteSkill',
      'skills:createSymlinks',
      'skills:copyToAgents',
    ]

    const malicious = '../etc/passwd'
    for (const channel of channels) {
      const schema = IPC_ARG_SCHEMAS[channel]!
      // Build a minimally-valid payload but inject the malicious skillName.
      // This avoids asserting the exact shape of each channel (too brittle)
      // while still exercising the skillName refinement.
      const payload: { skillName: string; [k: string]: unknown } = {
        skillName: malicious,
      }
      // Supply the other required fields for schemas that need them.
      if (channel === 'skills:unlinkFromAgent') {
        payload.agentId = 'cursor'
        payload.linkPath = '/tmp/x'
      } else if (channel === 'skills:createSymlinks') {
        payload.skillPath = '/tmp/x'
        payload.agentIds = ['cursor']
      } else if (channel === 'skills:copyToAgents') {
        payload.sourcePath = '/tmp/x'
        payload.targetAgentIds = ['cursor']
      }
      const result = schema.safeParse([payload])
      expect(
        result.success,
        `channel ${channel} should reject ${malicious}`,
      ).toBe(false)
    }
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

  it('folder:revealInFinder accepts an absolute path', () => {
    expect(finderSchema.safeParse(['/Users/me/.agents/skills']).success).toBe(
      true,
    )
  })

  it('folder:revealInFinder rejects empty string', () => {
    expect(finderSchema.safeParse(['']).success).toBe(false)
  })

  it('folder:revealInFinder rejects relative path', () => {
    expect(finderSchema.safeParse(['relative/path']).success).toBe(false)
  })

  it('folder:openInTerminal mirrors the same absolute-path guard', () => {
    expect(terminalSchema.safeParse(['/Users/me/.cline/skills']).success).toBe(
      true,
    )
    expect(terminalSchema.safeParse(['']).success).toBe(false)
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

  it('accepts the new preferredTerminal field', () => {
    expect(schema.safeParse([{ preferredTerminal: 'iterm' }]).success).toBe(
      true,
    )
  })

  it('accepts customTerminalAppName within length cap', () => {
    expect(schema.safeParse([{ customTerminalAppName: 'Hyper' }]).success).toBe(
      true,
    )
  })

  it('accepts the bounded windowBackgroundBlurRadius field', () => {
    expect(schema.safeParse([{ windowBackgroundBlurRadius: 24 }]).success).toBe(
      true,
    )
  })

  it('accepts the auto-download preference boolean', () => {
    expect(schema.safeParse([{ autoDownloadUpdates: true }]).success).toBe(true)
  })

  it('rejects a non-boolean autoDownloadUpdates at the IPC boundary', () => {
    expect(schema.safeParse([{ autoDownloadUpdates: 'yes' }]).success).toBe(
      false,
    )
  })

  it('rejects an unknown enum value for preferredTerminal', () => {
    expect(
      schema.safeParse([{ preferredTerminal: 'fish-shell' }]).success,
    ).toBe(false)
  })

  it('rejects customTerminalAppName longer than 64 chars', () => {
    expect(
      schema.safeParse([{ customTerminalAppName: 'a'.repeat(65) }]).success,
    ).toBe(false)
  })

  it('rejects an invalid windowBackgroundBlurRadius value', () => {
    expect(
      schema.safeParse([
        {
          windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MIN_RADIUS - 1,
        },
      ]).success,
    ).toBe(false)
    expect(
      schema.safeParse([{ windowBackgroundBlurRadius: 24.5 }]).success,
    ).toBe(false)
    expect(
      schema.safeParse([
        {
          windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1,
        },
      ]).success,
    ).toBe(false)
  })

  it('rejects unknown extra keys (.strict())', () => {
    expect(
      schema.safeParse([{ defaultSkillTab: 'files', somethingElse: 'x' }])
        .success,
    ).toBe(false)
  })

  it('parsing a partial without hiddenAgentIds does NOT inject a default', () => {
    // Regression for the wipe-on-every-write bug: when the IPC schema for
    // `hiddenAgentIds` chained `.optional()` over the disk schema's
    // `.default([])`, every settings:set call that omitted the key
    // materialized `hiddenAgentIds: []` in the parsed output, which then
    // clobbered the persisted value via `{ ...current, ...partial }` in
    // saveSettings(). Pin this so the IPC schema can never re-inherit a
    // default.
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]
    expect('hiddenAgentIds' in parsed[0]).toBe(false)
  })

  it('parsing a partial without windowBackgroundBlurRadius does NOT inject a default', () => {
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]
    expect('windowBackgroundBlurRadius' in parsed[0]).toBe(false)
  })

  it('parsing a partial without autoDownloadUpdates does NOT inject its default', () => {
    // Same wipe-on-every-write guard as hiddenAgentIds/blur: the IPC schema
    // declares the toggle as a bare `z.boolean().optional()` rather than
    // chaining `.optional()` over the disk schema's `.default(false)`. If it
    // re-inherited the default, every unrelated settings:set would parse to
    // `{ autoDownloadUpdates: false }` and clobber a user's persisted opt-in.
    const parsed = schema.parse([{ defaultSkillTab: 'info' }]) as [object]
    expect('autoDownloadUpdates' in parsed[0]).toBe(false)
  })

  it('accepts an explicit hiddenAgentIds array on settings:set', () => {
    expect(
      schema.safeParse([{ hiddenAgentIds: ['claude-code'] }]).success,
    ).toBe(true)
  })

  it('rejects an unknown id in hiddenAgentIds at the IPC boundary', () => {
    // The renderer should never emit a non-AgentId. Disk reads are
    // forgiving (drop stale ids); the IPC channel is strict.
    expect(
      schema.safeParse([{ hiddenAgentIds: ['definitely-not-an-agent'] }])
        .success,
    ).toBe(false)
  })

  it('rejects a hiddenAgentIds payload longer than AGENT_IDS', () => {
    // Defense-in-depth payload cap — a misbehaving renderer cannot push
    // an arbitrarily long list past the IPC boundary. Every legitimate
    // entry beyond AGENT_IDS.length would have to be a duplicate anyway.
    const oversized = Array.from({ length: 100 }, () => 'claude-code' as const)
    expect(schema.safeParse([{ hiddenAgentIds: oversized }]).success).toBe(
      false,
    )
  })
})
