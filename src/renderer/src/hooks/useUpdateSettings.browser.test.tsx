import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { AppToaster } from '@/renderer/src/components/AppToaster'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import settingsReducer, {
  setSettings,
} from '@/renderer/src/redux/slices/settingsSlice'
import themeReducer from '@/renderer/src/redux/slices/themeSlice'
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from '@/shared/settings'

import { useUpdateSettings } from './useUpdateSettings'

const save = vi.fn<(_: Partial<Settings>) => Promise<Settings>>()
const reload = vi.fn<() => Promise<Settings>>()
let persistedSettings: Settings

beforeEach(() => {
  persistedSettings = DEFAULT_SETTINGS
  // Match the IPC contract: successful writes return the complete canonical snapshot.
  save.mockReset().mockImplementation(async (partial) => {
    persistedSettings = { ...persistedSettings, ...partial }
    return persistedSettings
  })
  reload.mockReset().mockImplementation(async () => persistedSettings)
  vi.stubGlobal('electron', { settings: { set: save, get: reload } })
})

afterEach(() => {
  toast.dismiss()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Exercises the shared save path with the same visible notification host used by both windows.
 * @returns Controls for independent and same-render edits.
 * @example <Editor />
 */
function Editor() {
  const update = useUpdateSettings()
  const settings = useAppSelector((state) => state.settings)
  return (
    <>
      <button
        type="button"
        onClick={() => update({ leftSectionOpacityPercent: 85 })}
      >
        Left
      </button>
      <button
        type="button"
        onClick={() => update({ rightSectionOpacityPercent: 90 })}
      >
        Right
      </button>
      <button
        type="button"
        onClick={() => {
          update({ leftSectionOpacityPercent: 85 })
          update({ rightSectionOpacityPercent: 90 })
        }}
      >
        Both
      </button>
      <button
        type="button"
        onClick={() => update({ windowSize: settings.windowSize })}
      >
        Save current size
      </button>
      <output>Left opacity: {settings.leftSectionOpacityPercent}%</output>
      <AppToaster />
    </>
  )
}

/** Mounts real reducers and the save hook so recovery tests observe persisted UI state.
 * @param initialSettings - Canonical preferences before the first edit.
 * @returns Store and controls for editing and receiving broadcasts.
 * @example const { store, screen } = await setup()
 */
async function setup(initialSettings: Settings = DEFAULT_SETTINGS) {
  persistedSettings = initialSettings
  const store = configureStore({
    reducer: { settings: settingsReducer, theme: themeReducer },
    preloadedState: { settings: initialSettings },
  })
  const screen = await render(
    <Provider store={store}>
      <Editor />
    </Provider>,
  )
  return { store, screen }
}

test('preserves two settings edited before the next render', async () => {
  // Arrange
  const { store, screen } = await setup()
  // Act
  await screen.getByRole('button', { name: 'Both' }).click()
  // Assert
  expect(store.getState().settings).toMatchObject({
    leftSectionOpacityPercent: 85,
    rightSectionOpacityPercent: 90,
  })
  expect(save).toHaveBeenCalledTimes(2)
})

test('shows a save failure and restores the saved settings', async () => {
  // Arrange
  save.mockRejectedValueOnce(new Error('disk full'))
  const { store, screen } = await setup()
  // Act
  await screen.getByRole('button', { name: 'Left', exact: true }).click()
  // Assert
  await expect
    .element(screen.getByText('Settings could not be saved', { exact: true }))
    .toBeVisible()
  await expect
    .poll(() => store.getState().settings.leftSectionOpacityPercent)
    .toBe(100)
  expect(reload).toHaveBeenCalledOnce()
})

test('does not start recovery when a later successful edit supersedes the failed snapshot', async () => {
  // Arrange
  let fail!: (error: Error) => void
  save.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject
    }),
  )
  const { store, screen } = await setup()
  // Act
  await screen.getByRole('button', { name: 'Left', exact: true }).click()
  await screen.getByRole('button', { name: 'Right', exact: true }).click()
  fail(new Error('late failure'))
  // Assert
  await expect
    .element(screen.getByText('Settings could not be saved', { exact: true }))
    .toBeVisible()
  expect(reload).not.toHaveBeenCalled()
  expect(store.getState().settings.rightSectionOpacityPercent).toBe(90)
})

test.each(['edit', 'broadcast'] as const)(
  'ignores a delayed recovery after a newer %s',
  async (source) => {
    // Arrange
    let resolveReload!: (settings: Settings) => void
    reload.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReload = resolve
      }),
    )
    save.mockRejectedValueOnce(new Error('disk full'))
    const { store, screen } = await setup()
    await screen.getByRole('button', { name: 'Left', exact: true }).click()
    await expect.poll(() => reload.mock.calls.length).toBe(1)
    // Act
    if (source === 'edit') {
      await screen.getByRole('button', { name: 'Right', exact: true }).click()
    } else {
      store.dispatch(
        setSettings({ ...DEFAULT_SETTINGS, rightSectionOpacityPercent: 90 }),
      )
    }
    resolveReload(DEFAULT_SETTINGS)
    await vi.waitFor(() =>
      expect(store.getState().settings.rightSectionOpacityPercent).toBe(90),
    )
    // Assert — allow the already-settled recovery continuation to finish.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().settings.rightSectionOpacityPercent).toBe(90)
  },
)

test('offers a visible reload action when saving and resynchronizing both fail', async () => {
  // Arrange
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  save.mockRejectedValue(new Error('disk full'))
  reload.mockRejectedValue(new Error('IPC disconnected'))
  const { screen } = await setup()
  // Act
  await screen.getByRole('button', { name: 'Left', exact: true }).click()
  await screen.getByRole('button', { name: 'Right', exact: true }).click()
  // Assert
  await expect
    .element(
      screen.getByText('Settings could not be reloaded', { exact: true }),
    )
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Reload', exact: true }))
    .toBeVisible()
  await expect.poll(() => reload.mock.calls.length).toBe(2)
  expect(errorLog).toHaveBeenCalledWith(
    'Settings save failed',
    new Error('disk full'),
  )
  expect(errorLog).toHaveBeenCalledWith(
    'Settings recovery failed',
    new Error('IPC disconnected'),
  )
})

test('restores a failed opacity edit after a later successful save changes nothing on disk', async () => {
  // Arrange — General can save the already-persisted window size while opacity is still saving.
  const canonical = SettingsSchema.parse({
    windowSize: { width: 1200, height: 800 },
  })
  let rejectOpacity!: (error: Error) => void
  let resolveSize!: (settings: Settings) => void
  save
    .mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectOpacity = reject
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSize = resolve
      }),
    )
  const { store, screen } = await setup(canonical)

  // Act — the failed save skips recovery, and the no-op save produces no broadcast.
  await screen.getByRole('button', { name: 'Left', exact: true }).click()
  await screen.getByRole('button', { name: 'Save current size' }).click()
  rejectOpacity(new Error('disk unavailable'))
  await expect
    .element(screen.getByText('Settings could not be saved', { exact: true }))
    .toBeVisible()
  resolveSize(canonical)

  // Assert — the successful response must reconcile the failed field too.
  await expect.element(screen.getByText('Left opacity: 100%')).toBeVisible()
  expect(store.getState().settings.windowSize).toEqual({
    width: 1200,
    height: 800,
  })
  expect(reload).not.toHaveBeenCalled()
})

test.each(['edit', 'broadcast'] as const)(
  'does not overwrite a newer %s with a delayed save response',
  async (source) => {
    // Arrange
    let resolveOlderSave!: (settings: Settings) => void
    let resolveNewerSave!: (settings: Settings) => void
    save.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOlderSave = resolve
      }),
    )
    const { store, screen } = await setup()
    await screen.getByRole('button', { name: 'Left', exact: true }).click()

    // Act — keep a newer local edit pending or deliver a canonical cross-window update.
    if (source === 'edit') {
      save.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNewerSave = resolve
        }),
      )
      await screen.getByRole('button', { name: 'Right', exact: true }).click()
    } else {
      store.dispatch(
        setSettings({ ...DEFAULT_SETTINGS, rightSectionOpacityPercent: 90 }),
      )
    }
    const newerSnapshot = store.getState().settings
    resolveOlderSave({ ...DEFAULT_SETTINGS, leftSectionOpacityPercent: 85 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Assert — the old response cannot replace either a pending edit or a newer broadcast.
    expect(store.getState().settings).toBe(newerSnapshot)
    expect(store.getState().settings.rightSectionOpacityPercent).toBe(90)
    if (source === 'edit') resolveNewerSave(newerSnapshot)
  },
)

test.each(['edit', 'broadcast'] as const)(
  'does not show an obsolete reload prompt when recovery fails after a newer %s',
  async (source) => {
    // Arrange
    let rejectRecovery!: (error: Error) => void
    reload.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRecovery = reject
      }),
    )
    save.mockRejectedValueOnce(new Error('disk unavailable'))
    const { store, screen } = await setup()
    await screen.getByRole('button', { name: 'Left', exact: true }).click()
    await expect.poll(() => reload.mock.calls.length).toBe(1)

    // Act — the UI receives a newer setting before the obsolete recovery rejects.
    if (source === 'edit') {
      await screen.getByRole('button', { name: 'Right', exact: true }).click()
    } else {
      store.dispatch(
        setSettings({ ...DEFAULT_SETTINGS, rightSectionOpacityPercent: 90 }),
      )
    }
    rejectRecovery(new Error('delayed IPC failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Assert — the original save error stays accurate; recovery no longer requires a reload.
    await expect
      .element(screen.getByText('Settings could not be saved', { exact: true }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Reload', exact: true }).query(),
    ).toBeNull()
    expect(store.getState().settings.rightSectionOpacityPercent).toBe(90)
  },
)
