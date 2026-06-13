import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'

import { COLOR_PRESET_CHROMA } from '@/shared/constants'
import type { Settings } from '@/shared/settings'
import type { AgentId } from '@/shared/types'

import { setSettings } from './slices/settingsSlice'
import { clearSelection } from './slices/skillsSlice'
import { setModePreference, setTheme } from './slices/themeSlice'
import type { ThemeState } from './slices/themeSlice'
import { fetchSyncPreview, selectAgent, setActiveTab } from './slices/uiSlice'

export const listenerMiddleware = createListenerMiddleware()

type ListenerEffectApi = Parameters<
  Parameters<typeof listenerMiddleware.startListening>[0]['effect']
>[1]

// Type for state accessed in listeners (avoids circular RootState import)
interface ListenerState {
  theme: ThemeState
  settings: Settings
  ui: { selectedAgentId: AgentId | null }
}

/**
 * Project the current `ThemeState` onto `<html>` as CSS custom properties
 * plus a `.light` / `.dark` class and, for tinted-neutral presets, a
 * `.tone-tinted` class. This is the only place that mutates the DOM for theme
 * purposes — Redux state stays authoritative and the CSS in `globals.css`
 * consumes `--theme-hue` / `--theme-chroma` directly.
 *
 * Neutral presets persist `chroma: 0`, which collapses every OKLCH token to
 * the grayscale axis and makes the `--theme-hue` angle irrelevant (so we
 * still set it for consistency; no visual change).
 */
function applyThemeToDOM(state: ThemeState): void {
  const { hue, chroma, mode } = state
  const root = document.documentElement
  root.style.setProperty('--theme-hue', String(hue))
  root.style.setProperty('--theme-chroma', String(chroma))
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
  // Tinted-neutral presets (0 < chroma < COLOR_PRESET_CHROMA) soften their
  // gray base via the `.tone-tinted` overrides in globals.css — lighter in
  // dark mode, deeper in light mode. Pure-neutral (chroma 0, the default) and
  // full-color (chroma === COLOR_PRESET_CHROMA) keep the crisp base ramp, so
  // the default neutral-dark appearance is unchanged.
  root.classList.toggle(
    'tone-tinted',
    chroma > 0 && chroma < COLOR_PRESET_CHROMA,
  )
}

/**
 * Tracks whether the `prefers-color-scheme` listener has been installed.
 * `ACTION_HYDRATE_COMPLETE` should only fire once per session, but a
 * conservative guard keeps the subscription idempotent if a future
 * code path replays the action (e.g. during hot module reload).
 */
let systemThemeListenerInstalled = false

/**
 * Wire `prefers-color-scheme` change events into the store so that when
 * the user picked "Auto" (modePreference === 'system'), the resolved
 * `mode` follows OS appearance changes in real time. Re-dispatching
 * `setModePreference('system')` is the simplest re-resolution path —
 * the reducer reads matchMedia again and swaps neutral preset keys if
 * needed, then the existing matcher below pushes the new state to the DOM.
 *
 * No-ops in headless environments (vitest unit lane uses happy-dom which
 * doesn't always implement matchMedia) so the listener stays safe to
 * import everywhere.
 */
function installSystemThemeListener(listenerApi: ListenerEffectApi): void {
  if (systemThemeListenerInstalled) return
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return
  }
  const systemQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemQuery.addEventListener('change', () => {
    // Explicit light/dark must stay sticky; only the "Auto" path reacts.
    const { theme } = listenerApi.getState() as ListenerState
    if (theme.modePreference === 'system') {
      listenerApi.dispatch(setModePreference('system'))
    }
  })
  systemThemeListenerInstalled = true
}

/**
 * Theme initialization listener
 * Applies persisted theme from localStorage after hydration completes.
 * This ensures the correct theme is shown after storage-middleware loads
 * state, and installs the system-theme subscription so future OS flips
 * propagate when the user is on "Auto".
 */
listenerMiddleware.startListening({
  type: ACTION_HYDRATE_COMPLETE,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
    installSystemThemeListener(listenerApi)
  },
})

/**
 * Theme switching side effect
 * Listens to all theme-related actions and applies CSS changes
 */
listenerMiddleware.startListening({
  matcher: isAnyOf(setTheme, setModePreference),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
  },
})

/**
 * Cross-slice atomic clear: dispatches `clearSelection` from skillsSlice on any
 * context switch that uiSlice already clears its own ephemeral state for
 * (bulkSelectMode, undoToast, bulkConfirm). Without this bridge the selection
 * survives across tab/agent changes, enabling the "action-over-hidden-state"
 * anti-pattern: SelectionToolbar renders on selection count alone and its
 * Delete/Unlink button commits against invisible ticks the user can no longer
 * audit. Living in listener.ts keeps both slices self-contained (one-way
 * consumer; no circular imports).
 *
 * Note: `deleteSelectedSkills.pending` and `unlinkSelectedFromAgent.pending`
 * are intentionally NOT in this matcher. Those thunks rely on the `.fulfilled`
 * reducers in skillsSlice to narrow `selectedSkillNames` to only the items
 * that actually succeeded, so failed rows stay ticked for retry. A blanket
 * clear on `.pending` would wipe the selection before the reconciliation can
 * run. uiSlice already clears `bulkSelectMode` on those same pending actions,
 * so the toolbar still hides during the in-flight op.
 */
listenerMiddleware.startListening({
  matcher: isAnyOf(setActiveTab, selectAgent, fetchSyncPreview.pending),
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(clearSelection())
  },
})

/**
 * Cross-slice invariant: when a settings update lands that hides the
 * currently-selected agent, clear the selection so the central skill
 * list doesn't keep filtering by an agent the user can no longer see
 * in the sidebar.
 *
 * Living here (instead of an `AgentsSection` `useEffect`) means the
 * invariant fires regardless of whether that component is mounted —
 * the Settings window can hide an agent during a navigation transition
 * in the main window without a window-of-vulnerability where the stale
 * selection survives. The cascading `selectAgent`-listener above also
 * clears `selectedSkillNames`, so the user never sees stale ticks
 * either.
 */
listenerMiddleware.startListening({
  actionCreator: setSettings,
  effect: (_action, listenerApi) => {
    const { ui, settings } = listenerApi.getState() as ListenerState
    if (
      ui.selectedAgentId !== null &&
      settings.hiddenAgentIds.includes(ui.selectedAgentId)
    ) {
      listenerApi.dispatch(selectAgent(null))
    }
  },
})
