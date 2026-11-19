import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  PERSIST_STATE_VERSION,
  PERSIST_STORAGE_KEY,
  THEME_PRESETS,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'
import type { Skill } from '@/shared/types'
import { toAbsolutePath, toSkillName, toSymlinkCount } from '@/shared/types'

import type { MigratableState } from './migrations'
import {
  clearSelection,
  fetchSkills,
  toggleSelection,
} from './slices/skillsSlice'
import { setActiveTab } from './slices/uiSlice'

/**
 * Regression tests for the full theme migration chain. Every user upgrading
 * from a pre-chroma release runs this path exactly once, and a silent
 * failure corrupts localStorage for that user forever. These tests pin the
 * end-state contract so future theme refactors cannot regress it.
 *
 * Each `migrate(state, 0)` call walks v0 → v1 → v2 → v3, so the expected
 * shape below is the post-chain (v3) shape including `modePreference`,
 * which v2 → v3 seeds from `state.mode`.
 */
async function migrate(
  state: Record<string, unknown> | null | undefined,
  oldVersion: number,
) {
  const { migrateState } = await import('./migrations')
  return migrateState(state as MigratableState, oldVersion)
}

describe('migrateState (v0 → v3 theme chain)', () => {
  test('upgrades a legacy color preset (cyan dark) into the full current theme shape', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 195,
        mode: 'dark',
        preset: 'cyan',
        presetType: 'color',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toEqual({
      hue: 195,
      chroma: 0.16,
      mode: 'dark',
      modePreference: 'dark',
      preset: 'cyan',
    })
  })

  test('upgrades a legacy neutral preset (neutral-light) into the full current theme shape', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        mode: 'light',
        preset: 'neutral-light',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toEqual({
      hue: 0,
      chroma: 0,
      mode: 'light',
      modePreference: 'light',
      preset: 'neutral-light',
    })
  })

  test('rescues a preset name that was renamed away to neutral-dark', async () => {
    // Arrange — simulates a user whose persisted state has a preset name that
    // was later removed or renamed (plan proposed `mono-dark` which was never
    // shipped; this guards against that class of drift).
    const state = {
      theme: {
        hue: 0,
        mode: 'dark',
        preset: 'mono-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  test('rescues a missing preset field to neutral-dark', async () => {
    // Arrange
    const state = {
      theme: { hue: 0, mode: 'dark', presetType: 'neutral' },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  test('drops a null theme slot so the reducer initial state takes over', async () => {
    // Arrange
    const state = { theme: null }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  test('drops a non-object theme slot from tampered storage', async () => {
    // Arrange
    const state = { theme: 'garbage' }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  test('leaves an undefined theme slot alone instead of fabricating one', async () => {
    // Arrange
    const state = {}

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  test('preserves a tampered current-schema theme when the stored version already matches', async () => {
    // Arrange — storage-middleware guarantees migrate is only called when
    // versions differ, but if someone tampered with the stored `version` field
    // we must not overwrite a valid current-schema state with legacy defaults.
    const { PERSIST_STATE_VERSION } = await import('@/shared/constants')
    const currentState = {
      theme: {
        hue: 195,
        chroma: 0.18,
        mode: 'dark',
        modePreference: 'dark',
        preset: 'cyan',
      },
    }

    // Act
    const result = await migrate(currentState, PERSIST_STATE_VERSION)

    // Assert
    expect(result.theme).toEqual(currentState.theme)
  })

  test('repairs a non-numeric hue to a safe 0', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 'not-a-number',
        mode: 'dark',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.hue).toBe(0)
  })

  test('repairs an invalid mode to dark', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        mode: 'purple',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.mode).toBe('dark')
  })

  test('paints a legacy color preset with full chroma', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 300,
        mode: 'dark',
        preset: 'violet',
        presetType: 'color',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.chroma).toBe(0.16)
  })

  test('leaves a legacy neutral preset (or missing presetType) grayscale', async () => {
    // Arrange
    const state = {
      theme: { hue: 0, mode: 'dark', preset: 'neutral-dark' },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.chroma).toBe(0)
  })

  test('keeps every shipped preset name selectable after migration', async () => {
    // Act & Assert — regression guard: if a future refactor removes a preset
    // key from THEME_PRESETS, this test catches it before shipping.
    for (const name of Object.keys(THEME_PRESETS)) {
      const config = THEME_PRESETS[name as keyof typeof THEME_PRESETS]
      const state = {
        theme: {
          hue: config.hue,
          mode: 'mode' in config ? config.mode : 'dark',
          preset: name,
          presetType: config.chroma === 0 ? 'neutral' : 'color',
        },
      }
      const result = await migrate(state, 0)
      expect(result.theme?.preset).toBe(name)
    }
  })
})

/**
 * Wiring contract for the singleton Redux store. These guard the module-level
 * `configureStore` assembly in store.ts: if a slice is dropped from the root
 * reducer the feature that reads it renders against `undefined` on first paint,
 * and if the listener middleware stops being prepended the cross-slice
 * selection-clear silently dies (stale ticks survive a tab switch, re-enabling
 * the "action-over-hidden-state" bug). Both are import-time regressions that no
 * slice-level test can catch.
 */
describe('store wiring (singleton assembly)', () => {
  test('exposes every feature slice on the initial state so no view paints against undefined', async () => {
    // Arrange
    const { store } = await import('./store')

    // Act
    const state = store.getState()

    // Assert — every key listed in combineReducers must be present and defined
    expect(Object.keys(state).sort()).toEqual([
      'activity',
      'agents',
      'bookmarks',
      'dashboard',
      'marketplace',
      'protect',
      'rendererPreferences',
      'settings',
      'skillLock',
      'skills',
      'theme',
      'ui',
      'update',
      'widgetPicker',
    ])
  })

  test('clears the skill selection when the active tab changes (listener middleware is prepended)', async () => {
    // Arrange — tick a skill so the selection is non-empty before the context
    // switch. The singleton store keeps state across tests, so start empty.
    const { store } = await import('./store')
    store.dispatch(clearSelection())
    store.dispatch(toggleSelection(toSkillName('alpha-skill')))
    expect(store.getState().skills.selectedSkillNames).toEqual(['alpha-skill'])

    // Act — switching tabs is a hard context change the cross-slice listener reacts to
    store.dispatch(setActiveTab('marketplace'))

    // Assert — the prepended listenerMiddleware dispatched clearSelection
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  test('clears the skill selection when a skills refresh fails and the list shows its error', async () => {
    // Arrange — two ticked rows before the refresh
    const { store } = await import('./store')
    store.dispatch(toggleSelection(toSkillName('alpha-skill')))
    store.dispatch(toggleSelection(toSkillName('beta-skill')))

    // Act — the refresh rejects, so SkillsList draws only the error text
    store.dispatch(fetchSkills.pending('refresh-failed'))
    store.dispatch(
      fetchSkills.rejected(new Error('disk read failed'), 'refresh-failed'),
    )

    // Assert — no tick can outlive the rows it pointed at
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  test('keeps the skill selection through a successful skills refresh', async () => {
    // Arrange — a failed bulk op leaves its retryable rows ticked, then
    // refreshes. The singleton store keeps state across tests, so start empty.
    const { store } = await import('./store')
    const retrySkill: Skill = {
      name: toSkillName('retry-skill'),
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/retry-skill'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(clearSelection())
    store.dispatch(toggleSelection(retrySkill.name))

    // Act — the refresh still finds the row the op could not remove
    store.dispatch(fetchSkills.pending('refresh-ok'))
    store.dispatch(fetchSkills.fulfilled([retrySkill], 'refresh-ok'))

    // Assert — only a failed refresh clears; the retry ticks survive
    expect(store.getState().skills.selectedSkillNames).toEqual(['retry-skill'])
  })
})

/**
 * The store's storage adapter rethrows a rejected write so the middleware can
 * retry it. That is only safe because the middleware (>= 0.5.0) still hydrates
 * when the startup migration write-back fails; on 0.4.x the same throw failed
 * hydration and the app booted on default settings with every save disabled.
 */
describe('persisted state boot (full localStorage)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  // Value: protects=deleted starter choices survive a real store restart; fails_when=hydration reseeds categories;
  // why_new=migration unit tests do not pass through the stored root merge; seam=none.
  test('keeps deleted starters absent across store restarts, even after the last category is deleted', async () => {
    // Arrange
    const bookmark = {
      name: 'audit',
      repo: 'owner/tools',
      url: 'https://example.test/pinned?rev=1',
      bookmarkedAt: '2026-11-01T00:00:00Z',
    }
    const values = new Map([
      [
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 5,
          state: { bookmarks: { items: [bookmark] } },
        }),
      ],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, bytes: string) => {
        values.set(key, bytes)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    })
    vi.resetModules()
    const { store: first } = await import('./store')
    const { assignBookmarkCategory, deleteBookmarkCategory } =
      await import('./slices/bookmarkSlice')
    await vi.waitFor(() =>
      expect(first.getState().bookmarks.items).toEqual([bookmark]),
    )
    first.dispatch(
      assignBookmarkCategory({
        name: toSkillName('audit'),
        categoryId: 'security',
      }),
    )

    // Act — cross a durable save and a fresh root merge after one deletion, then after deleting every starter.
    first.dispatch(deleteBookmarkCategory('security'))
    await vi.waitFor(() =>
      expect(
        JSON.parse(
          values.get(PERSIST_STORAGE_KEY)!,
        ).state.bookmarks.categories.map((c: { id: string }) => c.id),
      ).toEqual(['code-review', 'frontend-design', 'planning']),
    )
    vi.resetModules()
    const { store: second } = await import('./store')
    await vi.waitFor(() =>
      expect(second.getState().bookmarks.items).toEqual([bookmark]),
    )
    expect(
      second.getState().bookmarks.categories.map((category) => category.id),
    ).toEqual(['code-review', 'frontend-design', 'planning'])
    for (const id of ['code-review', 'frontend-design', 'planning'])
      second.dispatch(deleteBookmarkCategory(id))
    await vi.waitFor(() =>
      expect(
        JSON.parse(values.get(PERSIST_STORAGE_KEY)!).state.bookmarks.categories,
      ).toEqual([]),
    )
    vi.resetModules()
    const { store: third } = await import('./store')

    // Assert — an intentional empty collection remains empty and the original URL and timestamp survive.
    await vi.waitFor(() =>
      expect(third.getState().bookmarks.items).toEqual([bookmark]),
    )
    expect(third.getState().bookmarks.categories).toEqual([])
  })

  test('the shared warning survives dismissal and preview saves, clears on settings recovery, then reports a new failure', async () => {
    // Arrange — upgrade an actual v5 envelope with an exact source URL.
    const legacy = {
      version: 5,
      state: {
        bookmarks: {
          items: [
            {
              name: 'audit',
              repo: 'owner/tools',
              url: 'https://example.test/pinned?rev=1',
              bookmarkedAt: '2026-11-01T00:00:00Z',
            },
          ],
        },
      },
    }
    const values = new Map([[PERSIST_STORAGE_KEY, JSON.stringify(legacy)]])
    let full = false
    const setItem = vi.fn((key: string, bytes: string) => {
      if (full && key === PERSIST_STORAGE_KEY)
        throw new DOMException('full', 'QuotaExceededError')
      values.set(key, bytes)
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
      removeItem: (key: string) => values.delete(key),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    const { toast } = await import('sonner')
    const notify = vi.spyOn(toast, 'error')
    const dismiss = vi
      .spyOn(toast, 'dismiss')
      .mockReturnValue(PERSIST_STORAGE_KEY)
    const { store } = await import('./store')
    const { assignBookmarkCategory } = await import('./slices/bookmarkSlice')
    const { setMarkdownPreviewMode } =
      await import('./slices/rendererPreferencesSlice')
    await vi.waitFor(() =>
      expect(JSON.parse(values.get(PERSIST_STORAGE_KEY)!).version).toBe(6),
    )
    const lastSaved = values.get(PERSIST_STORAGE_KEY)
    full = true

    // Act — closing a toast or persisting the preview preference must not end the shared failure series.
    store.dispatch(
      assignBookmarkCategory({
        name: toSkillName('audit'),
        categoryId: 'security',
      }),
    )
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
    expect(values.get(PERSIST_STORAGE_KEY)).toBe(lastSaved)
    toast.dismiss(PERSIST_STORAGE_KEY)
    dismiss.mockClear()
    const failedCalls = setItem.mock.calls.filter(
      ([key]) => key === PERSIST_STORAGE_KEY,
    ).length
    store.dispatch(setMarkdownPreviewMode('reading'))
    await vi.waitFor(() =>
      expect(
        JSON.parse(values.get(RENDERER_PREFERENCES_STORAGE_KEY) ?? '{}').state
          ?.rendererPreferences?.markdownPreviewMode,
      ).toBe('reading'),
    )
    await vi.waitFor(() =>
      expect(
        setItem.mock.calls.filter(([key]) => key === PERSIST_STORAGE_KEY)
          .length,
      ).toBeGreaterThan(failedCalls),
    )
    expect(notify).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalledWith(PERSIST_STORAGE_KEY)
    full = false
    store.dispatch(setActiveTab('marketplace'))
    await vi.waitFor(() =>
      expect(dismiss).toHaveBeenCalledWith(PERSIST_STORAGE_KEY),
    )
    expect(
      JSON.parse(values.get(PERSIST_STORAGE_KEY)!).state.bookmarks.items,
    ).toEqual([{ ...legacy.state.bookmarks.items[0], categoryId: 'security' }])
    full = true
    store.dispatch(
      assignBookmarkCategory({
        name: toSkillName('audit'),
        categoryId: 'planning',
      }),
    )

    // Assert — a second warning arrives while the last successful classification stays on disk.
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
    expect(
      JSON.parse(values.get(PERSIST_STORAGE_KEY)!).state.bookmarks.items[0]
        .categoryId,
    ).toBe('security')
  })

  test('boots on the migrated theme and keeps the old saved copy when localStorage rejects the migration write-back', async () => {
    // Arrange — a pre-chroma (v0) theme on disk, and a quota that rejects every write.
    const storedV0 = JSON.stringify({
      version: 0,
      state: {
        theme: { hue: 195, mode: 'dark', preset: 'cyan', presetType: 'color' },
      },
    })
    const values = new Map<string, string>([[PERSIST_STORAGE_KEY, storedV0]])
    const setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
      removeItem: (key: string) => {
        values.delete(key)
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()

    // Act
    const { store } = await import('./store')
    await vi.waitFor(() => {
      expect(store.getState().theme.preset).toBe('cyan')
    })

    // Assert — the user's migrated theme, with the v0 copy still on disk for the next launch.
    expect(store.getState().theme).toEqual({
      hue: 195,
      chroma: 0.16,
      mode: 'dark',
      modePreference: 'dark',
      preset: 'cyan',
    })
    expect(values.get(PERSIST_STORAGE_KEY)).toBe(storedV0)
    expect(setItem).toHaveBeenCalledWith(
      PERSIST_STORAGE_KEY,
      expect.any(String),
    )
  })

  test('saves the migrated settings on the next action after the preference store also finished hydrating', async () => {
    // Arrange — a v0 theme on disk; only the first settings write hits a full quota.
    const storedV0 = JSON.stringify({
      version: 0,
      state: {
        theme: { hue: 195, mode: 'dark', preset: 'cyan', presetType: 'color' },
      },
    })
    const values = new Map<string, string>([[PERSIST_STORAGE_KEY, storedV0]])
    let rejectNextSettingsWrite = true
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === PERSIST_STORAGE_KEY && rejectNextSettingsWrite) {
          rejectNextSettingsWrite = false
          throw new DOMException('quota', 'QuotaExceededError')
        }
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    const { store } = await import('./store')
    await vi.waitFor(() => {
      expect(store.getState().theme.preset).toBe('cyan')
      expect(store.getState().rendererPreferences.hydrated).toBe(true)
    })

    // Act — an action that leaves every persisted settings slice unchanged.
    store.dispatch(setActiveTab('marketplace'))

    // Assert — the second storage instance finishing hydration must not cancel the retry.
    await vi.waitFor(() => {
      expect(JSON.parse(values.get(PERSIST_STORAGE_KEY) ?? '{}')).toEqual(
        expect.objectContaining({
          version: PERSIST_STATE_VERSION,
          state: expect.objectContaining({
            theme: {
              hue: 195,
              chroma: 0.16,
              mode: 'dark',
              modePreference: 'dark',
              preset: 'cyan',
            },
          }),
        }),
      )
    })
  })
})
