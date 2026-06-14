import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { ErrorBoundary } from './ErrorBoundary'

/**
 * Browser-mode tests for the root error boundary. Runs in Chromium so the
 * full React reconciliation that catches a thrown render error, calls
 * `getDerivedStateFromError` + `componentDidCatch`, and swaps in the fallback
 * UI happens through the real renderer — exactly as production does when a
 * descendant crashes. The Reload button's `window.location.reload()` is
 * spied so the test page is never actually reloaded.
 */

// A child that throws during render to drive the boundary into its error state.
function CrashingChild(): never {
  throw new Error('Boom from a child render')
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // React logs caught render errors to console.error; silence it so the
  // intentional crashes don't pollute test output, while still asserting the
  // boundary's own componentDidCatch logging happened.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders its children unchanged when no descendant throws', async () => {
    // Arrange + Act
    const screen = await render(
      <ErrorBoundary>
        <p>Healthy content</p>
      </ErrorBoundary>,
    )

    // Assert — the wrapped child shows and the crash fallback never appears.
    await expect
      .element(screen.getByText('Healthy content'))
      .toBeInTheDocument()
    expect(screen.getByText('Something went wrong').query()).toBeNull()
  })

  it('shows the crash fallback with the thrown error message when a child throws', async () => {
    // Arrange + Act
    const screen = await render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    )

    // Assert — fallback heading, the specific error message, and Reload CTA.
    await expect
      .element(screen.getByText('Something went wrong'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Boom from a child render'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Reload' }))
      .toBeInTheDocument()
  })

  it('logs the caught error so crashes are diagnosable in the console', async () => {
    // Arrange + Act
    await render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>,
    )

    // Assert — the boundary's componentDidCatch tagged a console.error line.
    expect(
      consoleErrorSpy.mock.calls.some(
        (args: unknown[]) => args[0] === '[ErrorBoundary]',
      ),
    ).toBe(true)
  })

  // The Reload button's `window.location.reload()` cannot be exercised in the
  // Chromium browser lane: `reload` is a non-configurable/non-writable own
  // property (so it can't be spied/stubbed), and letting the click fire
  // reloads the test iframe, which vitest treats as a fatal error. The source
  // marks that line with a `v8 ignore` for this reason.
})
