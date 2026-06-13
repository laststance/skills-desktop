import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  IsoTimestamp,
  SkillName,
  ToastId,
  TombstoneId,
} from '@/shared/types'
import { tombstoneId } from '@/shared/types'

// `vi.hoisted` exposes the dismiss spy so the hoisted `vi.mock('sonner')`
// factory can reference it. UndoToast's only external dependency is
// `toast.dismiss`, which it calls after the Undo restore settles.
const { mockToastDismiss } = vi.hoisted(() => ({ mockToastDismiss: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { dismiss: mockToastDismiss },
}))

const TOAST_ID = 'bulk-delete-123' as ToastId
const TOMBSTONE_A = tombstoneId('1729180800000-task-a1b2c3d4')
const TOMBSTONE_B = tombstoneId('1729180800000-theme-e5f6a7b8')
const SUMMARY = 'Deleted 2 skills. 5 symlinks removed.'

/**
 * Build an absolute ISO timestamp `secondsFromNow` in the future so the
 * countdown starts at a known, controllable value.
 * @param secondsFromNow - Offset added to `Date.now()`.
 * @returns ISO string suitable for the `expiresAt` prop.
 * @example futureIso(30) // 30s undo window
 */
function futureIso(secondsFromNow: number): IsoTimestamp {
  return new Date(
    Date.now() + secondsFromNow * 1_000,
  ).toISOString() as IsoTimestamp
}

interface RenderOptions {
  skillNames?: SkillName[]
  tombstoneIds?: TombstoneId[]
  expiresAt?: IsoTimestamp
  summary?: string
  onUndo?: (ids: TombstoneId[]) => Promise<void> | void
}

async function renderUndoToast(options: RenderOptions = {}) {
  const onUndo = options.onUndo ?? vi.fn()
  const { UndoToast } = await import('./UndoToast')
  const screen = await render(
    <UndoToast
      skillNames={options.skillNames ?? (['task', 'theme'] as SkillName[])}
      tombstoneIds={options.tombstoneIds ?? [TOMBSTONE_A, TOMBSTONE_B]}
      expiresAt={options.expiresAt ?? futureIso(30)}
      summary={options.summary ?? SUMMARY}
      onUndo={onUndo}
      toastId={TOAST_ID}
    />,
  )
  return { screen, onUndo }
}

describe('UndoToast', () => {
  beforeEach(() => {
    mockToastDismiss.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the deletion summary so the user knows what was removed', async () => {
    // Arrange
    const { screen } = await renderUndoToast({ summary: SUMMARY })

    // Act
    // (no interaction — assert the static summary line)

    // Assert
    await expect.element(screen.getByText(SUMMARY)).toBeInTheDocument()
  })

  it('offers an Undo button labelled with the count of skills being restored', async () => {
    // Arrange
    const { screen } = await renderUndoToast({
      skillNames: ['task', 'theme'] as SkillName[],
    })

    // Act
    const undoButton = screen.getByRole('button', {
      name: 'Undo delete of 2 skills',
    })

    // Assert
    await expect.element(undoButton).toBeEnabled()
  })

  it('renders the countdown in muted color while the window is not yet urgent', async () => {
    // Arrange
    const { screen } = await renderUndoToast({ expiresAt: futureIso(30) })

    // Act
    const countdown = screen.getByLabelText('30 seconds remaining')

    // Assert
    await expect.element(countdown).toHaveClass('text-muted-foreground')
  })

  it('promotes the countdown to foreground color in the final urgent seconds', async () => {
    // Arrange
    const { screen } = await renderUndoToast({ expiresAt: futureIso(3) })

    // Act
    const countdown = screen.getByLabelText('3 seconds remaining')

    // Assert
    await expect.element(countdown).toHaveClass('text-foreground')
  })

  it('ticks the countdown down over time as the window closes', async () => {
    // Arrange
    const { screen } = await renderUndoToast({ expiresAt: futureIso(2) })

    // Act
    // The setInterval tick recomputes remaining time every 250ms; poll until
    // the displayed seconds drop, proving the interval callback runs.
    // (no explicit interaction — time passing is the trigger)

    // Assert
    await expect
      .poll(() => screen.getByLabelText('1 seconds remaining').query(), {
        timeout: 2_500,
      })
      .not.toBeNull()
  })

  it('swaps the button for a restoring spinner while the undo is in flight', async () => {
    // Arrange
    // A never-resolving onUndo keeps the component pinned in the restoring
    // state long enough to observe the spinner label.
    let resolveUndo: () => void = () => {}
    const pendingUndo = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          resolveUndo = resolve
        }),
    )
    const { screen } = await renderUndoToast({
      skillNames: ['task', 'theme'] as SkillName[],
      onUndo: pendingUndo,
    })

    // Act
    await screen
      .getByRole('button', { name: 'Undo delete of 2 skills' })
      .click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Restoring 2 skills' }))
      .toBeDisabled()

    // Cleanup: let the pending promise settle so no dangling handle remains.
    resolveUndo()
  })

  it('dismisses its own toast after the undo restore resolves', async () => {
    // Arrange
    const onUndo = vi.fn(async () => {})
    const { screen } = await renderUndoToast({ onUndo })

    // Act
    await screen
      .getByRole('button', { name: 'Undo delete of 2 skills' })
      .click()

    // Assert
    await expect.poll(() => onUndo.mock.calls.length).toBe(1)
    expect(onUndo).toHaveBeenCalledWith([TOMBSTONE_A, TOMBSTONE_B])
    await expect.poll(() => mockToastDismiss.mock.calls.length).toBe(1)
    expect(mockToastDismiss).toHaveBeenCalledWith(TOAST_ID)
  })

  it('uses singular grammar when exactly one skill is being restored', async () => {
    // Arrange
    const { screen } = await renderUndoToast({
      skillNames: ['task'] as SkillName[],
      tombstoneIds: [TOMBSTONE_A],
    })

    // Act
    const undoButton = screen.getByRole('button', {
      name: 'Undo delete of 1 skill',
    })

    // Assert
    await expect.element(undoButton).toBeEnabled()
  })

  it('hides the Undo affordance entirely for an informational unlink toast', async () => {
    // Arrange
    // Unlink produces no tombstones, so there is nothing to undo and the
    // button must not render at all (vs a dead disabled button).
    const { screen } = await renderUndoToast({
      tombstoneIds: [],
      summary: '5 symlinks removed.',
    })

    // Act
    // (no interaction — assert the absence of any undo control)

    // Assert
    await expect
      .element(screen.getByText('5 symlinks removed.'))
      .toBeInTheDocument()
    expect(screen.getByRole('button').query()).toBeNull()
  })

  it('disables Undo and refuses to restore once the window has already expired', async () => {
    // Arrange
    // An already-past expiry makes remainingMs 0, so canUndo is false: the
    // button renders disabled and no restore can be triggered.
    const onUndo = vi.fn(async () => {})
    const expiredAt = new Date(Date.now() - 1_000).toISOString() as IsoTimestamp
    const { screen } = await renderUndoToast({ expiresAt: expiredAt, onUndo })
    const undoButton = screen.getByRole('button', {
      name: 'Undo delete of 2 skills',
    })

    // Act
    // A click on the disabled button is a no-op in the browser; this confirms
    // the expired window cannot be undone via the UI.
    const buttonElement = undoButton.element()
    buttonElement.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )

    // Assert
    await expect.element(undoButton).toBeDisabled()
    expect(onUndo).not.toHaveBeenCalled()
    expect(mockToastDismiss).not.toHaveBeenCalled()
  })
})
