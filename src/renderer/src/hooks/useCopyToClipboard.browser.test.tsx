import { memo, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { useCopyToClipboard } from './useCopyToClipboard'

// `vi.hoisted` defines the toast spy so the hoisted `vi.mock('sonner')` factory
// (lifted above imports at runtime) can reference it without a TDZ error.
const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mockToastError } }))

const mockWriteText = vi.fn<(text: string) => Promise<void>>()
let originalClipboardDescriptor: PropertyDescriptor | undefined

/**
 * Minimal host exposing the hook's `copied` flag as DOM text and wiring a
 * button to `copy`, so the suite drives a real click and asserts observable
 * feedback the way the marketplace footer renders it.
 */
const CopyHarness = memo(function CopyHarness(): ReactElement {
  const { copied, copy } = useCopyToClipboard()
  return (
    <div>
      <output data-testid="copy-state">{copied ? 'copied' : 'idle'}</output>
      <button
        type="button"
        onClick={() => {
          void copy('https://skills.sh/task', 'preview URL')
        }}
      >
        Copy
      </button>
    </div>
  )
})

beforeEach(() => {
  mockToastError.mockReset()
  mockWriteText.mockReset()
  mockWriteText.mockResolvedValue(undefined)
  // Swap navigator.clipboard for a spy (restored in afterEach).
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  )
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
})

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
  vi.restoreAllMocks()
})

describe('useCopyToClipboard', () => {
  it('writes the given value to the clipboard', async () => {
    // Arrange
    const screen = await render(<CopyHarness />)

    // Act
    await screen.getByRole('button', { name: 'Copy' }).click()

    // Assert
    await vi.waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('https://skills.sh/task')
    })
  })

  it('lights the copied flag after a successful copy', async () => {
    // Arrange
    const screen = await render(<CopyHarness />)

    // Act
    await screen.getByRole('button', { name: 'Copy' }).click()

    // Assert
    await expect
      .element(screen.getByTestId('copy-state'))
      .toHaveTextContent('copied')
  })

  it('clears the copied flag after the feedback window elapses', async () => {
    // Arrange
    const screen = await render(<CopyHarness />)
    await screen.getByRole('button', { name: 'Copy' }).click()
    await expect
      .element(screen.getByTestId('copy-state'))
      .toHaveTextContent('copied')

    // Act + Assert — the real 1600ms window expires and the flash resets.
    await expect
      .element(screen.getByTestId('copy-state'), { timeout: 2500 })
      .toHaveTextContent('idle')
  })

  it('shows an error toast naming the failure label when the write rejects', async () => {
    // Arrange
    mockWriteText.mockRejectedValue(new Error('denied'))
    const screen = await render(<CopyHarness />)

    // Act
    await screen.getByRole('button', { name: 'Copy' }).click()

    // Assert — error toast fired and the flash never lit.
    await vi.waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to copy preview URL')
    })
    await expect
      .element(screen.getByTestId('copy-state'))
      .toHaveTextContent('idle')
  })
})
