import React, { useEffect, useMemo } from 'react'
import { Provider } from 'react-redux'
import type { Decorator } from '@storybook/react-vite'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { buildDefaultDashboardPages } from '@/renderer/src/components/dashboard/utils/widgetPresets'
import agentsReducer from '@/renderer/src/redux/slices/agentsSlice'
import bookmarkReducer from '@/renderer/src/redux/slices/bookmarkSlice'
import dashboardReducer from '@/renderer/src/redux/slices/dashboardSlice'
import marketplaceReducer from '@/renderer/src/redux/slices/marketplaceSlice'
import settingsReducer from '@/renderer/src/redux/slices/settingsSlice'
import skillsReducer from '@/renderer/src/redux/slices/skillsSlice'
import themeReducer from '@/renderer/src/redux/slices/themeSlice'
import uiReducer from '@/renderer/src/redux/slices/uiSlice'
import updateReducer from '@/renderer/src/redux/slices/updateSlice'
import type { ThemePresetName } from '@/shared/constants'
import { COLOR_PRESET_CHROMA, THEME_PRESETS } from '@/shared/constants'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type {
  BulkDeleteResult,
  BulkUnlinkResult,
  CreateSymlinksResult,
  RestoreDeletedSkillResult,
} from '@/shared/types'

import {
  storyAgents,
  storyBookmarks,
  storyMarketplaceSkills,
  storySettings,
  storySkillFileContent,
  storySkillFiles,
  storySkills,
  storySourceStats,
  storySyncPreview,
  storySyncResult,
  storyTombstoneIds,
} from './fixtures'

const rootReducer = combineReducers({
  theme: themeReducer,
  skills: skillsReducer,
  agents: agentsReducer,
  bookmarks: bookmarkReducer,
  ui: uiReducer,
  update: updateReducer,
  marketplace: marketplaceReducer,
  dashboard: dashboardReducer,
  settings: settingsReducer,
})

export type StoryRootState = ReturnType<typeof rootReducer>

type StoryThemeMode = StoryRootState['theme']['mode']

interface StorybookToolbarItem {
  title: string
  value: string
}

const DEFAULT_STORYBOOK_THEME_CHOICE = 'teal'
const DEFAULT_STORYBOOK_THEME_MODE: StoryThemeMode = 'dark'
const THEME_PRESET_NAMES = Object.keys(THEME_PRESETS) as ThemePresetName[]
const COLOR_THEME_PRESET_NAMES = THEME_PRESET_NAMES.filter(
  (name) => !('mode' in THEME_PRESETS[name]),
)
const NEUTRAL_THEME_FAMILIES = Array.from(
  new Set(
    THEME_PRESET_NAMES.flatMap((name) => {
      const config = THEME_PRESETS[name]
      if (!('mode' in config)) return []
      const lastDash = name.lastIndexOf('-')
      return lastDash < 0 ? [] : [name.slice(0, lastDash)]
    }),
  ),
)

export const STORYBOOK_THEME_PRESET_GLOBAL = 'themePreset'
export const STORYBOOK_THEME_MODE_GLOBAL = 'themeMode'
export const STORYBOOK_DEFAULT_THEME_PRESET = DEFAULT_STORYBOOK_THEME_CHOICE
export const STORYBOOK_DEFAULT_THEME_MODE = DEFAULT_STORYBOOK_THEME_MODE

export const STORYBOOK_THEME_PRESET_ITEMS: readonly StorybookToolbarItem[] = [
  ...COLOR_THEME_PRESET_NAMES.map((name) => ({
    title: THEME_PRESETS[name].label,
    value: name,
  })),
  ...NEUTRAL_THEME_FAMILIES.map((family) => ({
    title: family.charAt(0).toUpperCase() + family.slice(1),
    value: family,
  })),
]

export const STORYBOOK_THEME_MODE_ITEMS: readonly StorybookToolbarItem[] = [
  { title: 'Dark', value: 'dark' },
  { title: 'Light', value: 'light' },
]

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

declare module '@storybook/react-vite' {
  interface Parameters {
    skillsDesktop?: {
      state?: DeepPartial<StoryRootState>
      centered?: boolean
      width?: number | string
    }
  }
}

/**
 * Return true only for plain JSON-like objects.
 *
 * @param value - Unknown value from a state override.
 * @returns Whether the value can be recursively merged.
 * @example
 * isPlainRecord({ theme: { mode: 'dark' } }) // true
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Merge Storybook state overrides while replacing arrays wholesale.
 *
 * Redux slices store lists as arrays; merging arrays item-by-item would create
 * impossible hybrid rows. Objects recurse, arrays and primitives replace.
 *
 * @param base - Default story state.
 * @param override - Per-story override from `parameters.skillsDesktop.state`.
 * @returns A complete state object suitable for `preloadedState`.
 * @example
 * mergeDeep(base, { ui: { activeTab: 'marketplace' } })
 */
function mergeDeep<T>(base: T, override?: DeepPartial<T>): T {
  if (override === undefined) return base
  if (Array.isArray(base) || !isPlainRecord(base) || !isPlainRecord(override)) {
    return override as T
  }

  const result: Record<string, unknown> = { ...base }
  Object.entries(override).forEach(([key, nextValue]) => {
    const currentValue = result[key]
    result[key] = mergeDeep(currentValue, nextValue as never)
  })
  return result as T
}

/**
 * Check whether a Storybook global points to a real app theme preset.
 *
 * @param value - Toolbar value restored by Storybook.
 * @returns Whether the value can be safely used as a ThemePresetName.
 * @example
 * isThemePresetName('cyan') // true
 */
function isThemePresetName(value: unknown): value is ThemePresetName {
  return typeof value === 'string' && value in THEME_PRESETS
}

/**
 * Normalize the Storybook mode toolbar to the app's two supported modes.
 *
 * @param value - Raw Storybook global value.
 * @returns A light or dark mode, falling back to the default Storybook mode.
 * @example
 * resolveStorybookThemeMode('light') // 'light'
 */
function resolveStorybookThemeMode(value: unknown): StoryThemeMode {
  return value === 'light' || value === 'dark'
    ? value
    : DEFAULT_STORYBOOK_THEME_MODE
}

/**
 * Resolve the toolbar's theme choice into the concrete Redux preset key.
 *
 * Storybook exposes neutral families as `neutral`, `zinc`, etc. so the Mode
 * toolbar can choose the dark/light member. Color presets are already concrete
 * preset keys and keep their hue while the mode changes independently.
 *
 * @param choice - Raw theme value from Storybook globals.
 * @param mode - Resolved dark/light mode.
 * @returns Concrete ThemePresetName used by the Redux theme slice.
 * @example
 * resolveStorybookThemePreset('zinc', 'light') // 'zinc-light'
 */
function resolveStorybookThemePreset(
  choice: unknown,
  mode: StoryThemeMode,
): ThemePresetName {
  if (typeof choice === 'string') {
    const familyPreset = `${choice}-${mode}`
    // Neutral/tinted family choices map to their dark/light concrete preset.
    if (isThemePresetName(familyPreset)) return familyPreset

    if (isThemePresetName(choice)) {
      const config = THEME_PRESETS[choice]
      if (!('mode' in config)) return choice

      const lastDash = choice.lastIndexOf('-')
      const family = lastDash < 0 ? choice : choice.slice(0, lastDash)
      const modeAdjustedPreset = `${family}-${mode}`
      // Persisted direct neutral preset values still respect the Mode toolbar.
      if (isThemePresetName(modeAdjustedPreset)) return modeAdjustedPreset
    }
  }

  return DEFAULT_STORYBOOK_THEME_CHOICE
}

/**
 * Build a Redux theme state from Storybook toolbar globals.
 *
 * @param globals - Storybook globals object, usually `context.globals`.
 * @returns Complete theme slice state to merge into the story store.
 * @example
 * createStorybookThemeState({ themePreset: 'rose', themeMode: 'light' })
 */
function createStorybookThemeState(
  globals: Record<string, unknown>,
): StoryRootState['theme'] {
  const mode = resolveStorybookThemeMode(globals[STORYBOOK_THEME_MODE_GLOBAL])
  const preset = resolveStorybookThemePreset(
    globals[STORYBOOK_THEME_PRESET_GLOBAL],
    mode,
  )
  const config = THEME_PRESETS[preset]

  const resolved = 'mode' in config ? config.mode : mode
  return {
    hue: config.hue,
    chroma: config.chroma,
    mode: resolved,
    // Storybook has no notion of OS theme; mirror the resolved mode so the
    // ThemeSelector dropdown's `Light` / `Dark` segmented control reflects
    // the same value as `<html>` even though Storybook drives it via toolbar.
    modePreference: resolved,
    preset,
  }
}

/**
 * Merge per-story state with toolbar-controlled theme state.
 *
 * Toolbar globals should be the final authority so changing the Storybook
 * toolbar immediately affects every story, even stories with custom fixtures.
 *
 * @param state - Optional story-level Redux state override.
 * @param globals - Storybook globals from the active toolbar selection.
 * @returns State override ready for `createStoryStore`.
 * @example
 * createStoryStateOverride(parameters.skillsDesktop?.state, context.globals)
 */
function createStoryStateOverride(
  state: DeepPartial<StoryRootState> | undefined,
  globals: Record<string, unknown>,
): DeepPartial<StoryRootState> {
  return mergeDeep(state ?? {}, {
    theme: createStorybookThemeState(globals),
  })
}

/**
 * Build the default Storybook state for component showcases.
 *
 * @returns Complete Redux state with realistic skills, agents, marketplace
 *   rows, dashboard pages, and user settings.
 * @example
 * const store = createStoryStore({ ui: { activeTab: 'marketplace' } })
 */
function createDefaultStoryState(): StoryRootState {
  const initial = rootReducer(undefined, { type: '@@storybook/init' })
  const pages = buildDefaultDashboardPages()
  const defaultState = mergeDeep(initial, {
    theme: {
      hue: 175,
      chroma: COLOR_PRESET_CHROMA,
      mode: 'dark',
      preset: 'teal',
    },
    skills: {
      items: storySkills,
      selectedSkill: storySkills[0],
      selectedSkillNames: [storySkills[0]?.name ?? 'design-review'],
    },
    agents: {
      items: storyAgents,
      loading: false,
      error: null,
    },
    bookmarks: {
      items: storyBookmarks,
    },
    ui: {
      activeTab: 'installed',
      sourceStats: storySourceStats,
      selectedAgentId: null,
      bulkSelectMode: true,
      searchQuery: '',
      syncPreview: null,
      syncResult: null,
      selectedBookmarkForDetail: null,
    },
    marketplace: {
      searchResults: storyMarketplaceSkills,
      leaderboard: {
        'all-time': {
          skills: storyMarketplaceSkills,
          lastFetched: Date.now(),
          filter: 'all-time',
          status: 'idle',
        },
        trending: {
          skills: storyMarketplaceSkills,
          lastFetched: Date.now(),
          filter: 'trending',
          status: 'idle',
        },
        hot: {
          skills: storyMarketplaceSkills,
          lastFetched: Date.now(),
          filter: 'hot',
          status: 'idle',
        },
      },
    },
    dashboard: {
      pages,
      currentPageId: pages[0]?.id ?? null,
      initialized: true,
    },
    settings: storySettings,
  })

  return defaultState
}

/**
 * Create an isolated Redux store per Storybook story.
 *
 * @param overrides - Optional state patch for a single story.
 * @returns Store configured with the app's real reducers and mock state.
 * @example
 * createStoryStore({ update: { status: 'available' } })
 */
export function createStoryStore(overrides?: DeepPartial<StoryRootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState: mergeDeep(createDefaultStoryState(), overrides),
  })
}

/**
 * Apply the app's theme axes to the Storybook document root.
 *
 * @param theme - Theme slice from the active story store.
 * @returns void
 * @example
 * applyStoryTheme(store.getState().theme)
 */
function applyStoryTheme(theme: StoryRootState['theme']): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme.mode === 'dark')
  root.classList.toggle('light', theme.mode === 'light')
  root.style.setProperty('--theme-hue', String(theme.hue))
  root.style.setProperty('--theme-chroma', String(theme.chroma))
}

/**
 * Install a browser-side stand-in for Electron's preload bridge.
 *
 * Storybook runs in a normal browser tab, so renderer components that call
 * `window.electron.*` need deterministic async mocks. The fake returns the
 * same fixtures used by the Redux store so mounted effects and clicked
 * actions stay coherent.
 *
 * @returns void
 * @example
 * installStorybookElectronMock()
 */
export function installStorybookElectronMock(): void {
  if (typeof window === 'undefined' || window.electron) return

  let currentSettings = { ...DEFAULT_SETTINGS, ...storySettings }
  const cleanup = () => undefined
  const deleteResult: BulkDeleteResult = {
    items: [
      {
        skillName: storySkills[0]?.name ?? 'design-review',
        outcome: 'deleted',
        tombstoneId: storyTombstoneIds[0]!,
        symlinksRemoved: 3,
        cascadeAgents: ['claude-code', 'cursor'],
      },
    ],
  }
  const unlinkResult: BulkUnlinkResult = {
    items: [
      {
        skillName: storySkills[0]?.name ?? 'design-review',
        outcome: 'unlinked',
      },
    ],
  }
  const createSymlinksResult: CreateSymlinksResult = {
    success: true,
    created: 1,
    failures: [],
  }
  const restoreResult: RestoreDeletedSkillResult = {
    outcome: 'restored',
    symlinksRestored: 3,
    symlinksSkipped: 0,
  }

  window.electron = {
    shell: {
      openExternal: async () => undefined,
    },
    skills: {
      getAll: async () => storySkills,
      unlinkFromAgent: async () => ({ success: true }),
      removeAllFromAgent: async () => ({ success: true, removedCount: 4 }),
      deleteSkill: async () => ({
        success: true,
        symlinksRemoved: 3,
        cascadeAgents: ['claude-code', 'cursor'],
      }),
      createSymlinks: async () => createSymlinksResult,
      copyToAgents: async () => ({ success: true, copied: 1, failures: [] }),
      deleteSkills: async () => deleteResult,
      clearOrphanSymlinks: async (options) => ({
        // Echo the requested rows 1:1 so stories reflect exactly what was
        // selected, preserving skill identity and order.
        items: options.items.map((item) => ({
          skillName: item.skillName,
          outcome: 'orphan-cleared' as const,
          symlinksRemoved: item.agents.length,
          cascadeAgents: item.agents.map((agent) => agent.agentId),
        })),
      }),
      clearBrokenSymlinkSlots: async (options) => ({
        // Echo each requested slot 1:1, keeping the caller's agent + link path
        // instead of substituting a hardcoded fixture.
        items: options.items.map((item) => ({
          agentId: item.agentId,
          skillName: item.linkName,
          linkPath: item.linkPath,
          outcome: 'unlinked' as const,
        })),
      }),
      unlinkManyFromAgent: async () => unlinkResult,
      restoreDeletedSkill: async () => restoreResult,
      onDeleteProgress: () => cleanup,
    },
    agents: {
      getAll: async () => storyAgents,
    },
    source: {
      getStats: async () => storySourceStats,
    },
    files: {
      list: async () => storySkillFiles,
      read: async () => storySkillFileContent,
      readBinary: async () => ({
        name: 'diagram.png',
        dataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="%230b1118"/><path d="M40 120h240" stroke="%2322d3ee" stroke-width="10" stroke-linecap="round"/><circle cx="82" cy="90" r="28" fill="%2334d399"/><circle cx="160" cy="72" r="28" fill="%2322d3ee"/><circle cx="238" cy="90" r="28" fill="%23f59e0b"/></svg>',
        mimeType: 'image/svg+xml',
        size: 9280,
      }),
    },
    update: {
      onChecking: () => cleanup,
      onAvailable: () => cleanup,
      onNotAvailable: () => cleanup,
      onProgress: () => cleanup,
      onDownloaded: () => cleanup,
      onError: () => cleanup,
      download: async () => undefined,
      install: async () => undefined,
      check: async () => undefined,
    },
    skillsCli: {
      search: async () => storyMarketplaceSkills,
      install: async () => ({
        success: true,
        stdout: 'installed',
        stderr: '',
        code: 0,
      }),
      cancel: async () => undefined,
      onProgress: () => cleanup,
    },
    marketplace: {
      leaderboard: async () => storyMarketplaceSkills,
    },
    sync: {
      preview: async (options) => ({
        ...storySyncPreview,
        forAgent: options?.agentId,
      }),
      execute: async () => storySyncResult,
    },
    settings: {
      open: async () => undefined,
      get: async () => currentSettings,
      set: async (partial) => {
        currentSettings = { ...currentSettings, ...partial }
        return currentSettings
      },
      onChanged: () => cleanup,
    },
    folder: {
      revealInFinder: async () => ({ ok: true }),
      openInTerminal: async () => ({ ok: true }),
    },
    window: {
      getMainBounds: async () => ({ width: 1200, height: 800 }),
    },
  }

  window.confirm = () => true
}

interface StoryProviderProps {
  children: React.ReactNode
  state?: DeepPartial<StoryRootState>
  centered?: boolean
  width?: number | string
}

/**
 * Provider stack shared by every story.
 *
 * @param props - Story state overrides plus the story node.
 * @returns A themed frame containing Redux and Radix tooltip providers.
 * @example
 * <SkillsDesktopStoryProvider state={{ ui: { activeTab: 'marketplace' } }} />
 */
const SkillsDesktopStoryProvider = React.memo(
  function SkillsDesktopStoryProvider({
    children,
    state,
    centered = false,
    width,
  }: StoryProviderProps): React.ReactElement {
    const store = useMemo(() => createStoryStore(state), [state])

    useEffect(() => {
      const syncThemeToDom = (): void => {
        applyStoryTheme(store.getState().theme)
      }

      syncThemeToDom()
      return store.subscribe(syncThemeToDom)
    }, [store])

    const frameStyle =
      width === undefined
        ? undefined
        : ({ maxWidth: width, width: '100%', margin: '0 auto' } as const)

    return (
      <Provider store={store}>
        <TooltipProvider delayDuration={120}>
          <div className="skills-story-surface">
            <div
              className={
                centered
                  ? 'skills-story-frame skills-story-frame--center'
                  : 'skills-story-frame'
              }
            >
              <div style={frameStyle}>{children}</div>
            </div>
          </div>
        </TooltipProvider>
      </Provider>
    )
  },
)

/**
 * Global Storybook decorator that supplies app state and Electron mocks.
 *
 * @param Story - Storybook story component.
 * @param context - Story metadata, including `parameters.skillsDesktop`.
 * @returns The story wrapped in Skills Desktop providers.
 * @example
 * export const preview = { decorators: [withSkillsDesktopProviders] }
 */
export const withSkillsDesktopProviders: Decorator = (Story, context) => {
  const config = context.parameters.skillsDesktop
  const state = createStoryStateOverride(
    config?.state,
    context.globals as Record<string, unknown>,
  )

  return (
    <SkillsDesktopStoryProvider
      state={state}
      centered={config?.centered}
      width={config?.width}
    >
      <Story />
    </SkillsDesktopStoryProvider>
  )
}

interface StoryCardProps {
  label: string
  children: React.ReactNode
  className?: string
}

/**
 * Small labelled shell for grouped primitive stories.
 *
 * @param props - Label, children, and optional className for sizing.
 * @returns A labelled card using the same Storybook preview chrome.
 * @example
 * <StoryCard label="Primary button"><Button>Save</Button></StoryCard>
 */
export const StoryCard = React.memo(function StoryCard({
  label,
  children,
  className = '',
}: StoryCardProps): React.ReactElement {
  return (
    <section className={`skills-story-card p-4 ${className}`}>
      <div className="skills-story-label">{label}</div>
      {children}
    </section>
  )
})

interface StoryGridProps {
  children: React.ReactNode
  columns?: 1 | 2 | 3
}

/**
 * Responsive grid used by component collection stories.
 *
 * @param props - Story cards and preferred desktop column count.
 * @returns A CSS grid that keeps dense app components readable.
 * @example
 * <StoryGrid columns={2}><StoryCard ... /></StoryGrid>
 */
export const StoryGrid = React.memo(function StoryGrid({
  children,
  columns = 2,
}: StoryGridProps): React.ReactElement {
  const columnClass =
    columns === 3
      ? 'lg:grid-cols-3'
      : columns === 2
        ? 'lg:grid-cols-2'
        : 'lg:grid-cols-1'
  return (
    <div className={`grid grid-cols-1 gap-4 ${columnClass}`}>{children}</div>
  )
})
