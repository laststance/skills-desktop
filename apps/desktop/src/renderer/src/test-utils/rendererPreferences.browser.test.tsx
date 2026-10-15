import { expect, test, vi } from 'vitest'

import { setMarkdownPreviewMode } from '@/renderer/src/redux/slices/rendererPreferencesSlice'
import {
  MARKDOWN_PREVIEW_MODE_KEY,
  RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'

import { createPreferencesFixture } from './rendererPreferences'

// Value: protects=fixture teardown finishes durable writes before the next fixture hydrates; fails_when=disposal only waits for the debounce timer while a native Web Lock still blocks the save; why_new=component assertions cannot control Chromium lock contention; seam=none,no_claim=production-window-shutdown
test('keeps teardown pending until a blocked Reading preference is saved for the next fixture', async () => {
  // Arrange
  const keys = [
    MARKDOWN_PREVIEW_MODE_KEY,
    RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
    RENDERER_PREFERENCES_STORAGE_KEY,
  ]
  const previous = keys.map((key) => [key, localStorage.getItem(key)] as const)
  for (const key of keys) localStorage.removeItem(key)

  let releaseLock = (): void => {}
  let lockAcquired = (): void => {}
  const acquired = new Promise<void>((resolve) => {
    lockAcquired = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const heldLock = navigator.locks.request(
    RENDERER_PREFERENCES_STORAGE_KEY,
    async () => {
      lockAcquired()
      return blocked
    },
  )
  await acquired
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let fixture: Awaited<ReturnType<typeof createPreferencesFixture>> | undefined
  let nextFixture:
    Awaited<ReturnType<typeof createPreferencesFixture>> | undefined
  let disposal: Promise<void> | undefined

  try {
    fixture = await createPreferencesFixture()

    // Act
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    let disposed = false
    disposal = fixture.dispose().then(() => {
      disposed = true
    })
    await vi.advanceTimersByTimeAsync(350)

    // Assert
    // Confirm the real save is queued before testing the teardown boundary.
    const locks = await navigator.locks.query()
    expect(locks.pending?.map((lock) => lock.name)).toContain(
      RENDERER_PREFERENCES_STORAGE_KEY,
    )
    expect(disposed).toBe(false)
    expect(localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY)).toBeNull()

    // Act
    releaseLock()
    await heldLock
    await disposal
    nextFixture = await createPreferencesFixture()

    // Assert
    expect(disposed).toBe(true)
    expect(
      nextFixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('reading')
  } finally {
    // Release native contention even when the pending-disposal assertion fails.
    releaseLock()
    await heldLock
    vi.useRealTimers()
    await (disposal ?? fixture?.dispose())
    await nextFixture?.dispose()
    await navigator.locks.request(RENDERER_PREFERENCES_STORAGE_KEY, () => {})
    // Restore this origin only after every fixture write has finished.
    for (const [key, value] of previous) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  }
})
