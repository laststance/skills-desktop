import { describe, expect, it } from 'vitest'

import {
  AGENT_DEFINITIONS,
  GSTACK_BADGE_AGENT_IDS,
  GSTACK_REPOSITORY_URL,
  UNIVERSAL_AGENT_IDS,
} from './constants'

describe('AGENT_DEFINITIONS', () => {
  it('has unique ids', () => {
    const ids = AGENT_DEFINITIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique cliIds', () => {
    const cliIds = AGENT_DEFINITIONS.map((a) => a.cliId)
    expect(new Set(cliIds).size).toBe(cliIds.length)
  })

  it('windsurf uses .codeium/windsurf dir (matches skills CLI globalSkillsDir)', () => {
    const windsurf = AGENT_DEFINITIONS.find((a) => a.id === 'windsurf')
    expect(windsurf).toBeDefined()
    expect(windsurf!.dir).toBe('.codeium/windsurf')
  })

  it('all dirs start with a dot', () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.dir.startsWith('.')).toBe(true)
    }
  })

  it('syncs CLI globalSkillsDir parents for shared/universal agents', () => {
    const cline = AGENT_DEFINITIONS.find((a) => a.id === 'cline')
    const warp = AGENT_DEFINITIONS.find((a) => a.id === 'warp')
    const amp = AGENT_DEFINITIONS.find((a) => a.id === 'amp')
    const kimiCli = AGENT_DEFINITIONS.find((a) => a.id === 'kimi-cli')
    const opencode = AGENT_DEFINITIONS.find((a) => a.id === 'opencode')
    const deepAgents = AGENT_DEFINITIONS.find((a) => a.id === 'deepagents')
    const replit = AGENT_DEFINITIONS.find((a) => a.id === 'replit')

    expect(cline?.dir).toBe('.agents')
    expect(warp?.dir).toBe('.agents')
    expect(amp?.dir).toBe('.config/agents')
    expect(kimiCli?.dir).toBe('.config/agents')
    expect(opencode?.dir).toBe('.config/opencode')
    expect(deepAgents?.dir).toBe('.deepagents/agent')
    expect(replit?.dir).toBe('.config/agents')
  })
})

describe('UNIVERSAL_AGENT_IDS', () => {
  it('all entries are valid AgentIds in AGENT_DEFINITIONS', () => {
    const allIds = AGENT_DEFINITIONS.map((a) => a.id)
    for (const id of UNIVERSAL_AGENT_IDS) {
      expect(allIds).toContain(id)
    }
  })

  it('contains expected Universal agents', () => {
    expect(UNIVERSAL_AGENT_IDS).toContain('amp')
    expect(UNIVERSAL_AGENT_IDS).toContain('antigravity')
    expect(UNIVERSAL_AGENT_IDS).toContain('cline')
    expect(UNIVERSAL_AGENT_IDS).toContain('codex')
    expect(UNIVERSAL_AGENT_IDS).toContain('cursor')
    expect(UNIVERSAL_AGENT_IDS).toContain('deepagents')
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
  it('gstack badge agent ids are valid AgentIds in AGENT_DEFINITIONS', () => {
    const allIds = AGENT_DEFINITIONS.map((a) => a.id)
    for (const id of GSTACK_BADGE_AGENT_IDS) {
      expect(allIds).toContain(id)
    }
  })

  it('gstack repository URL points to the canonical GitHub repository', () => {
    expect(GSTACK_REPOSITORY_URL).toBe('https://github.com/garrytan/gstack')
  })
})
