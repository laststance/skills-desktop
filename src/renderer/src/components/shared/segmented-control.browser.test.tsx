import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import {
  SegmentedControl,
  type SegmentedControlOption,
} from './segmented-control'

/**
 * SegmentedControl is the connected "Name/Repo"-style toggle generalized to N
 * options. It is presentational + controlled, so the contract worth pinning is
 * behavioral: it reports the picked value, it keeps exactly one option selected
 * (swallowing Radix's empty-string deselect so re-clicking the active segment is
 * a no-op), it scales past two options, and it can disable a single segment.
 *
 * Option arrays live at module scope (not inline in JSX) so their identity stays
 * stable across renders without manual memoization.
 */
const SCOPE_OPTIONS: ReadonlyArray<SegmentedControlOption<'name' | 'repo'>> = [
  { value: 'name', label: 'Name' },
  { value: 'repo', label: 'Repo' },
]

const COLOR_MODE_OPTIONS: ReadonlyArray<
  SegmentedControlOption<'light' | 'dark' | 'system'>
> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
]

const INSTALL_TARGET_OPTIONS: ReadonlyArray<
  SegmentedControlOption<'universal-only' | 'universal-and-agents'>
> = [
  { value: 'universal-only', label: 'Universal' },
  {
    value: 'universal-and-agents',
    label: 'Universal + agents',
    disabled: true,
  },
]

describe('SegmentedControl', () => {
  it('reports the picked value when the user selects a different segment', async () => {
    // Arrange
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl
        aria-label="Search field"
        value="name"
        onValueChange={onValueChange}
        options={SCOPE_OPTIONS}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: 'Repo' }).click()

    // Assert
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('repo')
  })

  it('keeps one option selected by ignoring a click on the already-active segment', async () => {
    // Arrange — 'name' is active, so clicking it makes Radix emit '' (deselect).
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl
        aria-label="Search field"
        value="name"
        onValueChange={onValueChange}
        options={SCOPE_OPTIONS}
      />,
    )

    // Act — re-click the active segment; awaiting .click() flushes Radix's
    // synchronous onValueChange, so no fixed delay is needed.
    await screen.getByRole('radio', { name: 'Name' }).click()

    // Assert — the empty-string deselect is swallowed, never surfaced to callers.
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('lets the user pick among three or more segments', async () => {
    // Arrange — three options proves the control is not hard-wired to two.
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl
        aria-label="Color mode"
        value="light"
        onValueChange={onValueChange}
        options={COLOR_MODE_OPTIONS}
      />,
    )

    // Assert — all three render as selectable segments.
    await expect
      .element(screen.getByRole('radio', { name: 'Light' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('radio', { name: 'Dark' }))
      .toBeInTheDocument()

    // Act — pick the last one.
    await screen.getByRole('radio', { name: 'Auto' }).click()

    // Assert
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('system')
  })

  it('disables an individual segment without disabling the rest', async () => {
    // Arrange — the second option is unavailable (e.g. no agents to install to).
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl
        aria-label="Install target"
        value="universal-only"
        onValueChange={onValueChange}
        options={INSTALL_TARGET_OPTIONS}
      />,
    )

    // Assert — the disabled segment is non-interactive while its sibling stays live.
    await expect
      .element(screen.getByRole('radio', { name: 'Universal + agents' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('radio', { name: 'Universal', exact: true }))
      .toBeEnabled()
  })
})
