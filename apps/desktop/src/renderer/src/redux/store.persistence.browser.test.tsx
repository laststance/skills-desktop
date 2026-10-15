import { afterEach, expect, test, vi } from 'vitest'

import {
  MARKDOWN_PREVIEW_MODE_KEY,
  PERSIST_STORAGE_KEY,
  RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'

import { setMarkdownPreviewMode } from './slices/rendererPreferencesSlice'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem(PERSIST_STORAGE_KEY)
  window.localStorage.removeItem(RENDERER_PREFERENCES_STORAGE_KEY)
  window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
  window.localStorage.removeItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY)
})

// Value: protects=failed preview saves publish the production warning once and keep the live choice; fails_when=the store drops its renderer warning callback or deduplication; why_new=adapter fixtures replace the reporter and cannot check actual toast delivery; seam=toast-observer,no_claim=visual-toast-rendering
test('warns once that preview preferences could not be saved while failed edits still apply', async () => {
  // Arrange
  window.localStorage.removeItem(PERSIST_STORAGE_KEY)
  window.localStorage.removeItem(RENDERER_PREFERENCES_STORAGE_KEY)
  window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
  window.localStorage.removeItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY)
  const write = Storage.prototype.setItem
  const setItem = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (key === RENDERER_PREFERENCES_STORAGE_KEY) {
        throw new DOMException('quota exhausted', 'QuotaExceededError')
      }
      write.call(this, key, value)
    })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { store } = await import('./store')
  await expect
    .poll(() => store.getState().rendererPreferences.hydrated)
    .toBe(true)

  // Act
  store.dispatch(setMarkdownPreviewMode('reading'))

  // Assert
  await expect.poll(() => toastError.mock.calls.length).toBe(1)
  expect(toastError).toHaveBeenCalledWith(
    'Preview preferences could not be saved',
    {
      description:
        'Your preview choice still applies now, but may reset after restart. The update notice may appear again because preferences could not be saved.',
      duration: Infinity,
      closeButton: true,
    },
  )
  expect(store.getState().rendererPreferences.markdownPreviewMode).toBe(
    'reading',
  )
  expect(window.localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(
    null,
  )

  // Act
  store.dispatch(setMarkdownPreviewMode('code'))

  // Assert
  await expect
    .poll(
      () =>
        setItem.mock.calls.filter(
          ([key]) => key === RENDERER_PREFERENCES_STORAGE_KEY,
        ).length,
    )
    .toBe(2)
  expect(toastError).toHaveBeenCalledTimes(1)
  expect(store.getState().rendererPreferences.markdownPreviewMode).toBe('code')
  expect(window.localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(
    null,
  )
})
