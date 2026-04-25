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
