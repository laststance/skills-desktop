import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { AgentId } from '@/shared/types'

import { AgentSelectionOption } from './AgentSelectionOption'

const CODEX_AGENT_ID = 'codex' as AgentId

interface RenderOptions {
  agentId?: AgentId
  checkboxId?: string
  name?: string
  checked?: boolean
  disabled?: boolean
  secondaryLabel?: string
  hoverClassName?: string
  onToggle?: (agentId: AgentId) => void
}

/**
 * AgentSelectionOption is a pure props component (no Redux/IPC), so the harness
 * just renders it with sensible defaults and lets each test override what it
 * needs to exercise — mirroring the SourceLink sibling's options-object shape.
 */
async function renderAgentSelectionOption(options: RenderOptions = {}) {
  const onToggle = options.onToggle ?? vi.fn()
  const screen = await render(
    <AgentSelectionOption
      agentId={options.agentId ?? CODEX_AGENT_ID}
      checkboxId={options.checkboxId ?? 'copy-codex'}
      name={options.name ?? 'Codex'}
      checked={options.checked ?? false}
      disabled={options.disabled ?? false}
      secondaryLabel={options.secondaryLabel}
      hoverClassName={options.hoverClassName ?? 'hover:bg-muted'}
      onToggle={onToggle}
    />,
  )
  return { screen, onToggle }
}

describe('AgentSelectionOption row selection', () => {
  it('toggles the agent when the user clicks anywhere on the row outside the checkbox', async () => {
    // Arrange
    const onToggle = vi.fn()
    const { screen } = await renderAgentSelectionOption({
      agentId: CODEX_AGENT_ID,
      name: 'Codex',
      onToggle,
    })

    // Act
    // Click the row's text label (the row wrapper's onClick → handleRowClick →
    // handleToggle) rather than the checkbox, which stops propagation.
    await screen.getByText('Codex').click()

    // Assert
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(CODEX_AGENT_ID)
  })

  it('toggles the agent when the user clicks the checkbox itself', async () => {
    // Arrange
    const onToggle = vi.fn()
    const { screen } = await renderAgentSelectionOption({
      agentId: CODEX_AGENT_ID,
      name: 'Codex',
      onToggle,
    })

    // Act
    await screen.getByRole('checkbox', { name: 'Codex' }).click()

    // Assert
    // The checkbox stops propagation, so the row handler does not also fire —
    // exactly one toggle reaches the parent.
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(CODEX_AGENT_ID)
  })

  it('does not toggle a disabled agent when its row is clicked', async () => {
    // Arrange
    const onToggle = vi.fn()
    const { screen } = await renderAgentSelectionOption({
      agentId: CODEX_AGENT_ID,
      name: 'Codex',
      disabled: true,
      onToggle,
    })

    // Act
    await screen.getByText('Codex').click()

    // Assert
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows a secondary label next to the agent name when provided', async () => {
    // Arrange
    const { screen } = await renderAgentSelectionOption({
      name: 'Codex',
      secondaryLabel: 'already installed',
    })

    // Act
    // (no interaction — assert the secondary label renders)

    // Assert
    await expect
      .element(screen.getByText('already installed'))
      .toBeInTheDocument()
  })
})
