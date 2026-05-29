import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AGENTS,
  isSharedAgentPath,
  SHARED_AGENT_PATHS,
  SOURCE_DIR,
} from './constants'

describe('AGENTS path computation', () => {
  // Regression guard: prior to the scanDir divergence, Cline and Warp
  // had path === SOURCE_DIR because their installDir ('.agents')
  // mirrored the CLI's globalSkillsDir. The scanner then read every
  // directory under SOURCE_DIR as if it were a "valid local skill" of
  // those agents, and the per-skill Inspector marked all source skills
  // as Valid for Cline/Warp. The fix splits `installDir` (kept for CLI
  // sync) from `scanDir` (used by AGENTS.path).
  it('scans Cline from its own home dir so source skills are not mislabeled as Cline-local', () => {
    // Arrange
    const cline = AGENTS.find((a) => a.id === 'cline')!

    // Act
    const clinePath = cline.path

    // Assert
    expect(clinePath).toBe(join(homedir(), '.cline', 'skills'))
    expect(clinePath).not.toBe(SOURCE_DIR)
  })

  it('scans Warp from its own home dir so source skills are not mislabeled as Warp-local', () => {
    // Arrange
    const warp = AGENTS.find((a) => a.id === 'warp')!

    // Act
    const warpPath = warp.path

    // Assert
    expect(warpPath).toBe(join(homedir(), '.warp', 'skills'))
    expect(warpPath).not.toBe(SOURCE_DIR)
  })

  it('keeps every agent path off the universal source so the scanner never surfaces source content as agent-local skills', () => {
    // If any agent path equals SOURCE_DIR, the scanner will surface
    // source content as that agent's local skills — the exact bug the
    // scanDir divergence was added to prevent. Future cli-upgrade syncs
    // that introduce new universal-style agents must diverge scanDir
    // from installDir.
    // Arrange
    const agentPaths = AGENTS.map((agent) => agent.path)

    // Act + Assert
    for (const agentPath of agentPaths) {
      expect(agentPath).not.toBe(SOURCE_DIR)
    }
  })
})

describe('SHARED_AGENT_PATHS', () => {
  it('protects the universal source dir so deleting an agent cannot wipe everyone’s shared skills', () => {
    // Arrange
    const universalSourceDir = SOURCE_DIR

    // Act
    const isGuarded = SHARED_AGENT_PATHS.has(universalSourceDir)

    // Assert
    expect(isGuarded).toBe(true)
  })

  it('guards ~/.agents/skills so the v0.13.0 delete-wipes-source regression cannot return', () => {
    // SOURCE_DIR resolves to this path and is unconditionally seeded into
    // SHARED_AGENT_PATHS. Post Cline/Warp scanDir divergence no other
    // agent aliases here, but SOURCE_DIR alone is enough to guard deletes.
    // Arrange
    const v0130RegressionPath = join(homedir(), '.agents', 'skills')

    // Act
    const isGuarded = SHARED_AGENT_PATHS.has(v0130RegressionPath)

    // Assert
    expect(isGuarded).toBe(true)
  })

  it('guards ~/.config/agents/skills so deleting amp or kimi-cli cannot wipe the dir they share', () => {
    // Arrange
    const sharedConfigPath = join(homedir(), '.config', 'agents', 'skills')

    // Act
    const isGuarded = SHARED_AGENT_PATHS.has(sharedConfigPath)

    // Assert
    expect(isGuarded).toBe(true)
  })

  it('lets an agent with its own dedicated dir be deleted without tripping the shared-path guard', () => {
    // Arrange
    const claude = AGENTS.find((a) => a.id === 'claude-code')!
    const cursor = AGENTS.find((a) => a.id === 'cursor')!
    const codex = AGENTS.find((a) => a.id === 'codex')!

    // Act
    const claudeIsGuarded = SHARED_AGENT_PATHS.has(claude.path)
    const cursorIsGuarded = SHARED_AGENT_PATHS.has(cursor.path)
    const codexIsGuarded = SHARED_AGENT_PATHS.has(codex.path)

    // Assert
    expect(claudeIsGuarded).toBe(false)
    expect(cursorIsGuarded).toBe(false)
    expect(codexIsGuarded).toBe(false)
  })

  it('guards the path that amp and kimi-cli both point at so neither delete destroys the other’s skills', () => {
    // amp and kimi-cli are the two agents whose scanDir resolves to the
    // same ~/.config/agents/skills directory; both must be guarded so a
    // delete on either cannot wipe the directory shared with the other.
    // Arrange
    const amp = AGENTS.find((a) => a.id === 'amp')!
    const kimiCli = AGENTS.find((a) => a.id === 'kimi-cli')!

    // Act
    const ampIsGuarded = SHARED_AGENT_PATHS.has(amp.path)
    const kimiCliIsGuarded = SHARED_AGENT_PATHS.has(kimiCli.path)

    // Assert
    expect(ampIsGuarded).toBe(true)
    expect(kimiCliIsGuarded).toBe(true)
  })
})

describe('isSharedAgentPath', () => {
  it('rejects a delete aimed straight at the universal source dir', () => {
    // Arrange
    const universalSourceDir = SOURCE_DIR

    // Act
    const isShared = isSharedAgentPath(universalSourceDir)

    // Assert
    expect(isShared).toBe(true)
  })

  it('allows a delete on an agent that owns its own private directory', () => {
    // Arrange
    const claude = AGENTS.find((a) => a.id === 'claude-code')!

    // Act
    const isShared = isSharedAgentPath(claude.path)

    // Assert
    expect(isShared).toBe(false)
  })

  it('allows a delete on a path that belongs to no known agent', () => {
    // Arrange
    const unknownPath = '/tmp/not-a-real-agent/skills'

    // Act
    const isShared = isSharedAgentPath(unknownPath)

    // Assert
    expect(isShared).toBe(false)
  })

  // Normalization guards — Set.has() does exact-string match, and
  // SHARED_AGENT_PATHS stores canonically-joined paths. Without a resolve()
  // normalization in isSharedAgentPath, these shapes would bypass the
  // check even though they point at the same on-disk target.
  it('still blocks a delete on the source dir when the path carries a trailing slash', () => {
    // Arrange
    const trailingSlashPath = SOURCE_DIR + '/'

    // Act
    const isShared = isSharedAgentPath(trailingSlashPath)

    // Assert
    expect(isShared).toBe(true)
  })

  it('still blocks a delete on the source dir when the path contains .. segments', () => {
    // e.g. /Users/me/.agents/skills/../skills → /Users/me/.agents/skills
    // Arrange
    const dotDotPath = join(SOURCE_DIR, '..', 'skills')

    // Act
    const isShared = isSharedAgentPath(dotDotPath)

    // Assert
    expect(isShared).toBe(true)
  })

  it('still blocks a delete on the source dir when the path contains a double slash', () => {
    // e.g. /Users/me/.agents//skills → /Users/me/.agents/skills
    // Arrange
    const doubleSlashPath = SOURCE_DIR.replace('/.agents/', '/.agents//')

    // Act
    const isShared = isSharedAgentPath(doubleSlashPath)

    // Assert
    expect(isShared).toBe(true)
  })
})
