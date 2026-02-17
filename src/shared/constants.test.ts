import { describe, expect, it } from 'vitest'

import {
  AGENT_DEFINITIONS,
  UNIVERSAL_AGENT_IDS,
  UNIVERSAL_FILTER_ID,
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

  it('windsurf uses .windsurf dir (not legacy .codeium/windsurf)', () => {
    const windsurf = AGENT_DEFINITIONS.find((a) => a.id === 'windsurf')
    expect(windsurf).toBeDefined()
    expect(windsurf!.dir).toBe('.windsurf')
  })

  it('all dirs start with a dot', () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.dir.startsWith('.')).toBe(true)
    }
  })

  it('kimi-cli is defined with .kimi dir', () => {
    const kimiCli = AGENT_DEFINITIONS.find((a) => a.id === 'kimi-cli')
    expect(kimiCli).toBeDefined()
    expect(kimiCli!.dir).toBe('.kimi')
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
    expect(UNIVERSAL_AGENT_IDS).toContain('codex')
    expect(UNIVERSAL_AGENT_IDS).toContain('gemini-cli')
    expect(UNIVERSAL_AGENT_IDS).toContain('github-copilot')
    expect(UNIVERSAL_AGENT_IDS).toContain('kimi-cli')
    expect(UNIVERSAL_AGENT_IDS).toContain('opencode')
  })
})

describe('UNIVERSAL_FILTER_ID', () => {
  it('is the string "universal"', () => {
    expect(UNIVERSAL_FILTER_ID).toBe('universal')
  })

  it('does not collide with any AgentId', () => {
    const allIds = AGENT_DEFINITIONS.map((a) => a.id) as string[]
    expect(allIds).not.toContain(UNIVERSAL_FILTER_ID)
  })
})
