import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AGENTS,
  isSharedAgentPath,
  SHARED_AGENT_PATHS,
  SOURCE_DIR,
} from './constants'

describe('SHARED_AGENT_PATHS', () => {
  it('always includes SOURCE_DIR so "delete agent" cannot wipe the universal source', () => {
    expect(SHARED_AGENT_PATHS.has(SOURCE_DIR)).toBe(true)
  })

  it('includes ~/.agents/skills — the v0.13.0 regression path', () => {
    // Cline + Warp both resolve here via AGENT_DEFINITIONS. SOURCE_DIR is also
    // this exact path. Three aliases => must be flagged.
    expect(SHARED_AGENT_PATHS.has(join(homedir(), '.agents', 'skills'))).toBe(
      true,
    )
  })

  it('includes ~/.config/agents/skills — aliased across amp/kimi-cli/replit', () => {
    expect(
      SHARED_AGENT_PATHS.has(join(homedir(), '.config', 'agents', 'skills')),
    ).toBe(true)
  })

  it('does not flag agents that own their own non-shared directory', () => {
    const claude = AGENTS.find((a) => a.id === 'claude-code')!
    const cursor = AGENTS.find((a) => a.id === 'cursor')!
    const codex = AGENTS.find((a) => a.id === 'codex')!

    expect(SHARED_AGENT_PATHS.has(claude.path)).toBe(false)
    expect(SHARED_AGENT_PATHS.has(cursor.path)).toBe(false)
    expect(SHARED_AGENT_PATHS.has(codex.path)).toBe(false)
  })

  it('includes every agent whose path aliases another agent', () => {
    const pathCounts = new Map<string, number>()
    for (const a of AGENTS)
      pathCounts.set(a.path, (pathCounts.get(a.path) ?? 0) + 1)

    for (const [path, count] of pathCounts) {
      if (count > 1) expect(SHARED_AGENT_PATHS.has(path)).toBe(true)
    }
  })
})

describe('isSharedAgentPath', () => {
  it('returns true for SOURCE_DIR', () => {
    expect(isSharedAgentPath(SOURCE_DIR)).toBe(true)
  })

  it('returns false for a non-shared agent path', () => {
    const claude = AGENTS.find((a) => a.id === 'claude-code')!
    expect(isSharedAgentPath(claude.path)).toBe(false)
  })

  it('returns false for an unknown path', () => {
    expect(isSharedAgentPath('/tmp/not-a-real-agent/skills')).toBe(false)
  })

  // Normalization guards — Set.has() does exact-string match, and
  // SHARED_AGENT_PATHS stores canonically-joined paths. Without a resolve()
  // normalization in isSharedAgentPath, these shapes would bypass the
  // check even though they point at the same on-disk target.
  it('normalizes trailing slash to prevent Set.has bypass', () => {
    expect(isSharedAgentPath(SOURCE_DIR + '/')).toBe(true)
  })

  it('normalizes .. segments to prevent bypass', () => {
    // e.g. /Users/me/.agents/skills/../skills → /Users/me/.agents/skills
    const bypass = join(SOURCE_DIR, '..', 'skills')
    expect(isSharedAgentPath(bypass)).toBe(true)
  })

  it('normalizes double-slash to prevent bypass', () => {
    // e.g. /Users/me/.agents//skills → /Users/me/.agents/skills
    const bypass = SOURCE_DIR.replace('/.agents/', '/.agents//')
    expect(isSharedAgentPath(bypass)).toBe(true)
  })
})
