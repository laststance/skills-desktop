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

describe('skills:cli:remove schema', () => {
  const schema = IPC_ARG_SCHEMAS['skills:cli:remove']!

  it('accepts a valid skill name', () => {
    expect(schema.safeParse([{ skillName: 'brainstorming' }]).success).toBe(
      true,
    )
  })

  it('accepts skill names with hyphens, digits, dots', () => {
    expect(
      schema.safeParse([{ skillName: 'theme-generator-2.0' }]).success,
    ).toBe(true)
  })

  it('rejects a skill name containing a forward slash (path traversal)', () => {
    // `../etc/passwd` would pass a naive string check but escape SOURCE_DIR
    // when joined. The regex guard is the first line of defense; `validatePath`
    // in removeSkillViaCli is the second.
    const result = schema.safeParse([{ skillName: '../etc/passwd' }])
    expect(result.success).toBe(false)
  })

  it('rejects a skill name containing a backslash (Windows path separator)', () => {
    expect(schema.safeParse([{ skillName: '..\\windows' }]).success).toBe(false)
  })

  it('rejects a skill name containing a null byte', () => {
    // Some libc wrappers truncate at `\0`, so `evil\0.good` could pass later
    // string checks while opening `evil`. Zod's refine is the explicit catch.
    expect(schema.safeParse([{ skillName: 'evil\0.good' }]).success).toBe(false)
  })

  it('rejects an empty skill name', () => {
    expect(schema.safeParse([{ skillName: '' }]).success).toBe(false)
  })

  it('rejects a missing skill name field', () => {
    expect(schema.safeParse([{}]).success).toBe(false)
  })

  it('rejects a non-string skill name', () => {
    expect(schema.safeParse([{ skillName: 123 }]).success).toBe(false)
  })

  it('rejects a non-array call payload', () => {
    expect(schema.safeParse({ skillName: 'task' }).success).toBe(false)
  })
})

describe('skills:cli:removeBatch schema', () => {
  const schema = IPC_ARG_SCHEMAS['skills:cli:removeBatch']!

  it('accepts a single-item batch', () => {
    expect(
      schema.safeParse([{ items: [{ skillName: 'brainstorming' }] }]).success,
    ).toBe(true)
  })

  it('accepts a large batch', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      skillName: `skill-${i}`,
    }))
    expect(schema.safeParse([{ items }]).success).toBe(true)
  })

  it('rejects an empty batch (must be at least 1)', () => {
    // Length-zero batches would spawn zero CLI calls and return an empty
    // result — a trivially-safe no-op, but also a silent bug. Better to
    // fail loudly at the IPC boundary so the caller's bug surfaces early.
    const result = schema.safeParse([{ items: [] }])
    expect(result.success).toBe(false)
  })

  it('rejects a batch where any item has a path-separator skill name', () => {
    // If a single item in a batch is malicious, the whole batch must reject —
    // we cannot partially execute because removeBatch is all-or-nothing from
    // the Zod perspective (per-item outcomes happen AFTER validation).
    const result = schema.safeParse([
      {
        items: [{ skillName: 'valid' }, { skillName: '../escape' }],
      },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects a batch with a null-byte skill name in any position', () => {
    const result = schema.safeParse([
      {
        items: [{ skillName: 'valid' }, { skillName: 'a\0b' }],
      },
    ])
    expect(result.success).toBe(false)
  })

  it('rejects a missing items field', () => {
    expect(schema.safeParse([{}]).success).toBe(false)
  })

  it('rejects a batch larger than 100 items (DoS cap)', () => {
    // Each item spawns an `npx skills remove` child process serially, so an
    // unbounded array could pin a CPU core and exhaust file descriptors on a
    // cold npm cache. The cap forces a malicious/buggy renderer to fail at
    // the IPC boundary instead of the spawn loop.
    const items = Array.from({ length: 101 }, (_, i) => ({
      skillName: `skill-${i}`,
    }))
    const result = schema.safeParse([{ items }])
    expect(result.success).toBe(false)
  })

  it('accepts a batch of exactly 100 items (DoS cap boundary)', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      skillName: `skill-${i}`,
    }))
    expect(schema.safeParse([{ items }]).success).toBe(true)
  })
})

describe('skillNameString consistency across channels', () => {
  // The same refined string is used by every skill-name-accepting channel;
  // a regression in one place would undermine the overall boundary. This
  // test asserts the uniformity explicitly — if someone adds a new channel
  // and forgets to use skillNameString, this will not catch it directly
  // but the `../` rejections above will (all channels share the refinement).
  it('rejects "../etc/passwd" across every skill-name-accepting channel', () => {
    const channels: Array<keyof typeof IPC_ARG_SCHEMAS> = [
      'skills:cli:remove',
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
