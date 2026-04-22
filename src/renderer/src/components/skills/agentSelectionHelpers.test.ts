import { describe, expect, it } from 'vitest'

import type { Agent } from '../../../../shared/types'

import { getTargetAgentsForSelection } from './agentSelectionHelpers'

/**
 * Creates a minimal Agent object for selection-helper unit tests.
 * @param overrides - Test-specific fields.
 * @returns Agent fixture with stable defaults.
 */
function makeAgent(overrides: Partial<Agent> & Pick<Agent, 'id'>): Agent {
  return {
    id: overrides.id,
    name: overrides.name ?? ('Agent' as Agent['name']),
    path: overrides.path ?? ('/tmp/skills' as Agent['path']),
    exists: overrides.exists ?? true,
    skillCount: overrides.skillCount ?? 0,
    localSkillCount: overrides.localSkillCount ?? 0,
  }
}

describe('getTargetAgentsForSelection', () => {
  it('keeps installed agents first and appends not-installed agents', () => {
    const agents: Agent[] = [
      makeAgent({ id: 'cursor', exists: true }),
      makeAgent({ id: 'amp', exists: false }),
      makeAgent({ id: 'codex', exists: true }),
      makeAgent({ id: 'augment', exists: false }),
    ]

    const result = getTargetAgentsForSelection(agents)

    expect(result.map((agent) => agent.id)).toEqual([
      'cursor',
      'codex',
      'amp',
      'augment',
    ])
  })

  it('excludes the source agent when excludeAgentId is provided', () => {
    const agents: Agent[] = [
      makeAgent({ id: 'claude-code', exists: true }),
      makeAgent({ id: 'cursor', exists: true }),
      makeAgent({ id: 'amp', exists: false }),
    ]

    const result = getTargetAgentsForSelection(agents, {
      excludeAgentId: 'claude-code',
    })

    expect(result.map((agent) => agent.id)).toEqual(['cursor', 'amp'])
  })
})
