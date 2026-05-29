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
  it('lists installed agents ahead of not-installed ones in the picker', () => {
    // Arrange
    const agents: Agent[] = [
      makeAgent({ id: 'cursor', exists: true }),
      makeAgent({ id: 'amp', exists: false }),
      makeAgent({ id: 'codex', exists: true }),
      makeAgent({ id: 'augment', exists: false }),
    ]

    // Act
    const result = getTargetAgentsForSelection(agents)

    // Assert
    expect(result.map((agent) => agent.id)).toEqual([
      'cursor',
      'codex',
      'amp',
      'augment',
    ])
  })

  it('hides the source agent from its own copy-target list', () => {
    // Arrange
    const agents: Agent[] = [
      makeAgent({ id: 'claude-code', exists: true }),
      makeAgent({ id: 'cursor', exists: true }),
      makeAgent({ id: 'amp', exists: false }),
    ]

    // Act
    const result = getTargetAgentsForSelection(agents, {
      excludeAgentId: 'claude-code',
    })

    // Assert
    expect(result.map((agent) => agent.id)).toEqual(['cursor', 'amp'])
  })
})

describe('buildCopyAgentOptionViewModel', () => {
  it('shows a selected available agent as pre-checked and clickable', () => {
    // Arrange
    const agent = makeAgent({ id: 'codex', exists: true, name: 'Codex' })

    // Act
    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map(),
      selectedAgentIds: ['codex' as AgentId],
      copying: false,
      isSourceUnavailable: false,
    })

    // Assert
    expect(result).toEqual({
      agentId: 'codex',
      name: 'Codex',
      checked: true,
      disabled: false,
      secondaryLabel: undefined,
    })
  })

  it('locks an occupied agent row as a broken-link target before considering install status', () => {
    // Arrange
    const agent = makeAgent({ id: 'cursor', exists: false, name: 'Cursor' })

    // Act
    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map([['cursor' as AgentId, 'broken']]),
      selectedAgentIds: [],
      copying: false,
      isSourceUnavailable: false,
    })

    // Assert
    expect(result).toMatchObject({
      checked: true,
      disabled: true,
      secondaryLabel: 'broken link',
    })
  })

  it('flags an inaccessible agent row as manual review rather than broken cleanup', () => {
    // Arrange
    const agent = makeAgent({ id: 'cursor', exists: true, name: 'Cursor' })

    // Act
    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map([['cursor' as AgentId, 'inaccessible']]),
      selectedAgentIds: [],
      copying: false,
      isSourceUnavailable: false,
    })

    // Assert
    expect(result).toMatchObject({
      checked: true,
      disabled: true,
      secondaryLabel: 'manual review required',
    })
  })

  it('greys out an otherwise-selectable row while a copy is in flight or the source is gone', () => {
    // Arrange
    const agent = makeAgent({ id: 'amp', exists: false, name: 'Amp' })

    // Act
    const result = buildCopyAgentOptionViewModel(agent, {
      occupiedAgentReasonById: new Map(),
      selectedAgentIds: [],
      copying: true,
      isSourceUnavailable: true,
    })

    // Assert
    expect(result).toMatchObject({
      checked: false,
      disabled: true,
      secondaryLabel: 'not installed',
    })
  })
})

describe('getAddAgentSecondaryLabel', () => {
  it('shows the broken-link reason on an occupied row even when the agent is not installed', () => {
    // Arrange / Act
    const label = getAddAgentSecondaryLabel({
      occupiedReason: 'broken',
      exists: false,
    })

    // Assert
    expect(label).toBe('broken link')
  })

  it('shows manual-review copy on an inaccessible destination row', () => {
    // Arrange / Act
    const label = getAddAgentSecondaryLabel({
      occupiedReason: 'inaccessible',
      exists: true,
    })

    // Assert
    expect(label).toBe('manual review required')
  })

  it('shows the not-installed hint on a free agent missing from disk', () => {
    // Arrange / Act
    const label = getAddAgentSecondaryLabel({
      occupiedReason: undefined,
      exists: false,
    })

    // Assert
    expect(label).toBe('not installed')
  })

  it('shows no secondary label on a free, already-installed agent row', () => {
    // Arrange / Act
    const label = getAddAgentSecondaryLabel({
      occupiedReason: undefined,
      exists: true,
    })

    // Assert
    expect(label).toBeUndefined()
  })
})
