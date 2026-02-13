import { describe, expect, it } from 'vitest'

import { AGENT_DEFINITIONS } from './constants'

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
})
