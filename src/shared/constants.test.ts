import { describe, expect, it } from 'vitest'

import {
  AGENT_DEFINITIONS,
  GSTACK_BADGE_AGENT_IDS,
  GSTACK_REPOSITORY_URL,
  UNIVERSAL_AGENT_IDS,
} from './constants'

describe('AGENT_DEFINITIONS', () => {
  it('never collides two agents on the same app-state id', () => {
    // Arrange
    const ids = AGENT_DEFINITIONS.map((a) => a.id)
    // Act
    const uniqueIdCount = new Set(ids).size
    // Assert
    expect(uniqueIdCount).toBe(ids.length)
  })

  it('never collides two agents on the same --agent CLI flag', () => {
    // Arrange
    const cliIds = AGENT_DEFINITIONS.map((a) => a.cliId)
    // Act
    const uniqueCliIdCount = new Set(cliIds).size
    // Assert
    expect(uniqueCliIdCount).toBe(cliIds.length)
  })

  it('installs Windsurf skills under .codeium/windsurf to match the skills CLI globalSkillsDir', () => {
    // Arrange / Act
    const windsurf = AGENT_DEFINITIONS.find((a) => a.id === 'windsurf')
    // Assert
    expect(windsurf).toBeDefined()
    expect(windsurf!.installDir).toBe('.codeium/windsurf')
  })

  it('keeps every install target inside a dot-prefixed home subdir', () => {
    // Arrange / Act / Assert
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.installDir.startsWith('.')).toBe(true)
    }
  })

  it('keeps every scan target inside a dot-prefixed home subdir', () => {
    // scanDir is required on every entry (no optional fallback). New
    // agents added via /cli-upgrade must declare scanDir explicitly,
    // which forces consideration of universal-source aliasing.
    // Arrange / Act / Assert
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.scanDir.startsWith('.')).toBe(true)
    }
  })

  it('keeps shared/universal agents pointed at the CLI globalSkillsDir parents', () => {
    // Arrange / Act
    const cline = AGENT_DEFINITIONS.find((a) => a.id === 'cline')
    const warp = AGENT_DEFINITIONS.find((a) => a.id === 'warp')
    const amp = AGENT_DEFINITIONS.find((a) => a.id === 'amp')
    const kimiCli = AGENT_DEFINITIONS.find((a) => a.id === 'kimi-cli')
    const opencode = AGENT_DEFINITIONS.find((a) => a.id === 'opencode')
    const deepAgents = AGENT_DEFINITIONS.find((a) => a.id === 'deepagents')
    const replit = AGENT_DEFINITIONS.find((a) => a.id === 'replit')

    // Assert
    expect(cline?.installDir).toBe('.agents')
    expect(warp?.installDir).toBe('.agents')
    expect(amp?.installDir).toBe('.config/agents')
    expect(kimiCli?.installDir).toBe('.config/agents')
    expect(opencode?.installDir).toBe('.config/opencode')
    expect(deepAgents?.installDir).toBe('.deepagents/agent')
    expect(replit?.installDir).toBe('.config/agents')
  })

  // Regression guard for the v0.13.0 cascade. Cline, Warp, and Dexto's
  // installDir points at the universal source; without a divergent
  // scanDir, the scanner would surface every source skill as their
  // "local skills".
  it('does not surface the whole universal source as Cline, Warp, or Dexto local skills', () => {
    // Arrange / Act
    const cline = AGENT_DEFINITIONS.find((a) => a.id === 'cline')
    const warp = AGENT_DEFINITIONS.find((a) => a.id === 'warp')
    const dexto = AGENT_DEFINITIONS.find((a) => a.id === 'dexto')

    // Assert
    expect(cline?.installDir).toBe('.agents')
    expect(cline?.scanDir).toBe('.cline')
    expect(warp?.installDir).toBe('.agents')
    expect(warp?.scanDir).toBe('.warp')
    expect(dexto?.installDir).toBe('.agents')
    expect(dexto?.scanDir).toBe('.dexto')
  })

  it('exposes every community agent added in CLI v1.5.5', () => {
    // Act
    const ids = AGENT_DEFINITIONS.map((a) => a.id)
    // Assert
    expect(ids).toContain('aider-desk')
    expect(ids).toContain('codearts-agent')
    expect(ids).toContain('codemaker')
    expect(ids).toContain('codestudio')
    expect(ids).toContain('devin')
    expect(ids).toContain('dexto')
    expect(ids).toContain('forgecode')
    expect(ids).toContain('hermes-agent')
    expect(ids).toContain('rovodev')
    expect(ids).toContain('tabnine-cli')
  })
})

describe('UNIVERSAL_AGENT_IDS', () => {
  it('lists only agents that exist in AGENT_DEFINITIONS', () => {
    // Arrange
    const allIds = AGENT_DEFINITIONS.map((a) => a.id)
    // Act / Assert
    for (const id of UNIVERSAL_AGENT_IDS) {
      expect(allIds).toContain(id)
    }
  })

  it('treats the 13 shared-source agents as Universal and excludes Replit', () => {
    // Arrange / Act / Assert
    expect(UNIVERSAL_AGENT_IDS).toContain('amp')
    expect(UNIVERSAL_AGENT_IDS).toContain('antigravity')
    expect(UNIVERSAL_AGENT_IDS).toContain('cline')
    expect(UNIVERSAL_AGENT_IDS).toContain('codex')
    expect(UNIVERSAL_AGENT_IDS).toContain('cursor')
    expect(UNIVERSAL_AGENT_IDS).toContain('deepagents')
    expect(UNIVERSAL_AGENT_IDS).toContain('dexto')
    expect(UNIVERSAL_AGENT_IDS).toContain('firebender')
    expect(UNIVERSAL_AGENT_IDS).toContain('gemini-cli')
    expect(UNIVERSAL_AGENT_IDS).toContain('github-copilot')
    expect(UNIVERSAL_AGENT_IDS).toContain('kimi-cli')
    expect(UNIVERSAL_AGENT_IDS).toContain('opencode')
    expect(UNIVERSAL_AGENT_IDS).toContain('warp')
    expect(UNIVERSAL_AGENT_IDS).not.toContain('replit')
  })
})

describe('GSTACK constants', () => {
  it('badges only agents that exist in AGENT_DEFINITIONS', () => {
    // Arrange
    const allIds = AGENT_DEFINITIONS.map((a) => a.id)
    // Act / Assert
    for (const id of GSTACK_BADGE_AGENT_IDS) {
      expect(allIds).toContain(id)
    }
  })

  it('links the gstack badge to the canonical GitHub repository', () => {
    // Arrange / Act / Assert
    expect(GSTACK_REPOSITORY_URL).toBe('https://github.com/garrytan/gstack')
  })
})
