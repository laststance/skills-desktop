import { describe, expect, it } from 'vitest'

import type { Agent, AgentId } from '@/shared/types'

import {
  buildCopyAgentOptionViewModel,
  getAddAgentSecondaryLabel,
  getTargetAgentsForSelection,
} from './agentSelectionHelpers'

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

describe('buildCopyAgentOptionViewModel', () => {
  it('marks a selected available agent as checked and enabled', () => {
    const agent = makeAgent({ id: 'codex', exists: true, name: 'Codex' })

    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map(),
      selectedAgentIds: ['codex' as AgentId],
      copying: false,
      isSourceUnavailable: false,
    })

    expect(result).toEqual({
      agentId: 'codex',
      name: 'Codex',
      checked: true,
      disabled: false,
      secondaryLabel: undefined,
    })
  })

  it('uses occupancy as the checked/disabled reason before install status', () => {
    const agent = makeAgent({ id: 'cursor', exists: false, name: 'Cursor' })

    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map([['cursor' as AgentId, 'broken']]),
      selectedAgentIds: [],
      copying: false,
      isSourceUnavailable: false,
    })

    expect(result).toMatchObject({
      checked: true,
      disabled: true,
      secondaryLabel: 'broken link',
    })
  })

  it('labels inaccessible occupancy as manual review instead of broken cleanup', () => {
    const agent = makeAgent({ id: 'cursor', exists: true, name: 'Cursor' })

    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map([['cursor' as AgentId, 'inaccessible']]),
      selectedAgentIds: [],
      copying: false,
      isSourceUnavailable: false,
    })

    expect(result).toMatchObject({
      checked: true,
      disabled: true,
      secondaryLabel: 'manual review required',
    })
  })

  it('disables otherwise-free rows while copying or source is unavailable', () => {
    const agent = makeAgent({ id: 'amp', exists: false, name: 'Amp' })

    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map(),
      selectedAgentIds: [],
      copying: true,
      isSourceUnavailable: true,
    })

    expect(result).toMatchObject({
      checked: false,
      disabled: true,
      secondaryLabel: 'not installed',
    })
  })
})

describe('getAddAgentSecondaryLabel', () => {
  it('uses occupied reason before install status', () => {
    expect(
      getAddAgentSecondaryLabel({
        occupiedReason: 'broken',
        exists: false,
      }),
    ).toBe('broken link')
  })

  it('returns manual review copy for inaccessible destinations', () => {
    expect(
      getAddAgentSecondaryLabel({
        occupiedReason: 'inaccessible',
        exists: true,
      }),
    ).toBe('manual review required')
  })

  it('returns not installed for free missing agents', () => {
    expect(
      getAddAgentSecondaryLabel({
        occupiedReason: undefined,
        exists: false,
      }),
    ).toBe('not installed')
  })

  it('returns undefined for free installed agents', () => {
    expect(
      getAddAgentSecondaryLabel({
        occupiedReason: undefined,
        exists: true,
      }),
    ).toBeUndefined()
  })
})
