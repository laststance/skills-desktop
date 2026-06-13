import { describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { useDebouncedCallback } from './useDebouncedCallback'

// Real timers + `vi.waitFor` polling: deterministic without the React-flush
// fragility of fake timers under vitest browser mode. The "not called yet"
// checks run synchronously right after `run()` — a real setTimeout cannot fire
// within that microtask gap, so they are not racy.
const DELAY_MS = 50

describe('useDebouncedCallback', () => {
  it('runs only the final call in a burst, and only after the quiet period', async () => {
    // Arrange
    const callback = vi.fn()
    const { result } = await renderHook(() =>
      useDebouncedCallback(callback, DELAY_MS),
    )

    // Act — three rapid calls; each restarts the timer.
    result.current.run('r')
    result.current.run('re')
    result.current.run('react')

    // Assert — nothing fires synchronously.
    expect(callback).not.toHaveBeenCalled()

    // Assert — after the quiet period only the final call runs, exactly once.
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1))
    expect(callback).toHaveBeenCalledWith('react')
  })

  it('cancel() drops a scheduled call so it never runs', async () => {
    // Arrange
    const callback = vi.fn()
    const { result } = await renderHook(() =>
      useDebouncedCallback(callback, DELAY_MS),
    )

    // Act — schedule, then immediately cancel before the quiet period elapses.
    result.current.run('react')
    result.current.cancel()

    // Assert — well past the delay, the callback still never fired.
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3))
    expect(callback).not.toHaveBeenCalled()
  })
})
