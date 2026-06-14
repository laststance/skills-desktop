import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DestructiveConfirmDialog } from './DestructiveConfirmDialog'

/**
 * Browser-mode tests for the shared destructive-confirm dialog. Runs in Chromium
 * so Radix's real Dialog mounts into the DOM and the AlertTriangle + Cancel /
 * Confirm affordance can be asserted exactly as a user encounters it: the right
 * heading, the description body, the icon tint for each severity, the spinner
 * while a destructive action runs, and the cancel/confirm wiring.
 */

describe('DestructiveConfirmDialog', () => {
  it('shows the title, description, and confirm label when open', async () => {
    // Arrange + Act
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={false}
        title="Delete Skill"
        description="Permanently delete this skill?"
        confirmLabel="Delete"
      />,
    )

    // Assert — the dialog surfaces its heading, body, and confirm action.
    await expect
      .element(screen.getByRole('dialog', { name: /Delete Skill/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Permanently delete this skill?'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .toBeVisible()
  })

  it('stays out of the document when closed', async () => {
    // Arrange + Act — open=false keeps Radix from portaling the dialog.
    const screen = await render(
      <DestructiveConfirmDialog
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={false}
        title="Delete Skill"
        description="Permanently delete this skill?"
      />,
    )

    // Assert
    expect(screen.getByRole('dialog').query()).toBeNull()
  })

  it('falls back to the Remove labels when no confirm or loading text is given', async () => {
    // Arrange + Act — omit confirmLabel/loadingLabel to exercise the defaults.
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={false}
        title="Remove Symlink"
        description="Remove this symlink?"
      />,
    )

    // Assert — the default "Remove" confirm label renders.
    await expect
      .element(screen.getByRole('button', { name: /^Remove$/ }))
      .toBeVisible()
  })

  it('tints the icon amber for the warning severity', async () => {
    // Arrange + Act — the warning variant takes the text-amber-500 branch.
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={false}
        iconVariant="warning"
        title="Heads Up"
        description="Proceed with caution?"
      />,
    )

    // Assert — the alert icon carries the amber severity class.
    const dialog = screen.getByRole('dialog', { name: /Heads Up/i })
    await expect.element(dialog).toBeInTheDocument()
    const amberIcon = dialog.element().querySelector('.text-amber-500')
    expect(amberIcon).not.toBeNull()
  })

  it('tints the icon destructive red by default', async () => {
    // Arrange + Act — no iconVariant falls to the text-destructive branch.
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={false}
        title="Delete Skill"
        description="Permanently delete this skill?"
      />,
    )

    // Assert — the alert icon carries the destructive severity class.
    const dialog = screen.getByRole('dialog', { name: /Delete Skill/i })
    await expect.element(dialog).toBeInTheDocument()
    const destructiveIcon = dialog.element().querySelector('.text-destructive')
    expect(destructiveIcon).not.toBeNull()
  })

  it('swaps the confirm button for a loading label while the action runs', async () => {
    // Arrange + Act — loading=true shows the spinner + loadingLabel branch.
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={true}
        title="Delete Skill"
        description="Permanently delete this skill?"
        confirmLabel="Delete"
        loadingLabel="Deleting..."
      />,
    )

    // Assert — the loading label replaces the confirm label.
    await expect
      .element(screen.getByRole('button', { name: /Deleting\.\.\./ }))
      .toBeVisible()
    expect(screen.getByRole('button', { name: /^Delete$/ }).query()).toBeNull()
  })

  it('disables both buttons while the destructive action is in flight', async () => {
    // Arrange + Act — loading=true must lock Cancel and Confirm.
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        loading={true}
        title="Delete Skill"
        description="Permanently delete this skill?"
        confirmLabel="Delete"
        loadingLabel="Deleting..."
      />,
    )

    // Assert — neither action can be triggered mid-delete.
    await expect
      .element(screen.getByRole('button', { name: /^Cancel$/ }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: /Deleting\.\.\./ }))
      .toBeDisabled()
  })

  it('confirms the destructive action when the confirm button is clicked', async () => {
    // Arrange
    const onConfirm = vi.fn()
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        loading={false}
        title="Delete Skill"
        description="Permanently delete this skill?"
        confirmLabel="Delete"
      />,
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('closes without confirming when the cancel button is clicked', async () => {
    // Arrange
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const screen = await render(
      <DestructiveConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        loading={false}
        title="Delete Skill"
        description="Permanently delete this skill?"
        confirmLabel="Delete"
      />,
    )

    // Act
    await screen.getByRole('button', { name: /^Cancel$/ }).click()

    // Assert — cancel routes to onClose and never confirms the deletion.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
