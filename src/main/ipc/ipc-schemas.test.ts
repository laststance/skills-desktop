import { describe, expect, it } from 'vitest'

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

  it('rejects unknown extra keys (.strict())', () => {
    expect(
      schema.safeParse([{ defaultSkillTab: 'files', somethingElse: 'x' }])
        .success,
    ).toBe(false)
  })
})
