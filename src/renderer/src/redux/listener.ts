import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'

import {
  COLOR_PRESET_CHROMA,
  LOCK_RESCAN_GRACE_MS,
  UNDO_WINDOW_MS,
} from '@/shared/constants'
import type { Settings } from '@/shared/settings'
import type { AgentId } from '@/shared/types'

import { setSettings } from './slices/settingsSlice'
import { fetchStaleLockEntries } from './slices/skillLockSlice'
import { clearSelection } from './slices/skillsSlice'
import { setModePreference, setTheme, syncTheme } from './slices/themeSlice'
import type { ThemeState } from './slices/themeSlice'
import {
  fetchSyncPreview,
  selectAgent,
  setActiveTab,
  setUndoToast,
} from './slices/uiSlice'

export const listenerMiddleware = createListenerMiddleware()

type ListenerEffectApi = Parameters<
  Parameters<typeof listenerMiddleware.startListening>[0]['effect']
>[1]

/**
 * The narrowest api the window-level theme subscriptions need: dispatch, and
 * a read of the one slice they consult. Typed structurally rather than as
 * `RootState` so `listener.ts` does not close an import cycle back through
 * `store.ts`, and narrowly enough that no `as` cast is needed at the read.
 */
interface ThemeSubscriptionApi {
  dispatch: ListenerEffectApi['dispatch']
  getState: () => { theme: ThemeState }
}

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
 * {@link installThemeSubscriptions} runs once per store, but a conservative
 * guard keeps the subscription idempotent if the module is re-evaluated
 * (e.g. during hot module reload).
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
function installSystemThemeListener(api: ThemeSubscriptionApi): void {
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
    const { theme } = api.getState()
    if (theme.modePreference === 'system') {
      api.dispatch(setModePreference('system'))
    }
  })
  systemThemeListenerInstalled = true
}

/**
 * Tracks whether the cross-window `theme:changed` subscription is installed.
 * Same idempotence guard as {@link systemThemeListenerInstalled}, and for the
 * same reason: one install per store, and a module re-evaluation must not
 * stack duplicate subscriptions.
 */
let themeBroadcastListenerInstalled = false

/**
 * Adopt theme changes made in the app's other window.
 *
 * Installed from `store.ts` so BOTH renderer entry points get it for free —
 * the main window and the Settings window load different HTML but the same
 * store module. Without this, switching the main window Dark -> Light left an
 * already open Settings window in the old palette until it was closed and
 * reopened: two windows of one app, visibly disagreeing.
 *
 * `window.electron` is absent in the vitest node lane, so the guard keeps
 * `listener.ts` safe to import headlessly, exactly like the matchMedia guard
 * above.
 */
function installThemeBroadcastListener(api: ThemeSubscriptionApi): void {
  if (themeBroadcastListenerInstalled) return
  if (typeof window === 'undefined' || !window.electron?.theme) return
  window.electron.theme.onChanged((nextTheme) => {
    api.dispatch(syncTheme(nextTheme))
  })
  themeBroadcastListenerInstalled = true
}

/**
 * Install the two window-level theme subscriptions: OS appearance changes and
 * the other window's `theme:changed` broadcast.
 *
 * Called once from `store.ts` at store creation rather than from the
 * `ACTION_HYDRATE_COMPLETE` handler, because that action is NOT dispatched
 * when localStorage holds nothing yet — the storage middleware short-circuits
 * on `persisted === null`. Hanging these off hydration meant a first launch
 * (or any launch after the user cleared storage) got neither subscription:
 * "Auto" silently stopped following macOS Appearance, and an open Settings
 * window would not follow the main window's palette.
 *
 * Both installers are individually idempotent, so a hot-module-reload replay
 * of this call cannot stack duplicate subscriptions.
 *
 * @param api - The Redux store, or any `{ dispatch, getState }` pair.
 * @example
 * export const store = configureStore({ ... })
 * installThemeSubscriptions(store)
 */
export function installThemeSubscriptions(api: ThemeSubscriptionApi): void {
  installSystemThemeListener(api)
  installThemeBroadcastListener(api)
}

/**
 * Theme initialization listener
 * Applies persisted theme from localStorage after hydration completes.
 * This ensures the correct theme is shown after storage-middleware loads
 * state. The window-level subscriptions are NOT installed here — see
 * {@link installThemeSubscriptions} for why hydration is the wrong trigger.
 */
listenerMiddleware.startListening({
  type: ACTION_HYDRATE_COMPLETE,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
  },
})

/**
 * Theme switching side effect
 * Listens to all theme-related actions and applies CSS changes, then tells
 * the app's other window to adopt the same palette.
 *
 * `syncTheme` is matched for the DOM write but NOT for the broadcast: it is
 * how a window ADOPTS someone else's theme, so re-publishing it would bounce
 * the same state between windows forever. Keeping the two concerns in one
 * listener (rather than two overlapping matchers) makes that asymmetry the
 * single visible line it is.
 */
listenerMiddleware.startListening({
  matcher: isAnyOf(setTheme, setModePreference, syncTheme),
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
    if (syncTheme.match(action)) return
    // Fire-and-forget: a failed relay costs the other window one stale
    // palette until its next theme change, which is strictly better than
    // an unhandled rejection tearing through the middleware.
    void window.electron?.theme?.broadcast(state.theme).catch(() => {})
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

/**
 * Re-check the skills CLI lock once a delete's undo window has closed.
 *
 * Deleting a skill only moves it to the trash, so the record is still
 * restorable and deliberately not counted as stale. Main prunes it when the
 * tombstone is evicted, but that prune is best effort — if it fails (no `npx`
 * on PATH, CLI error) the record really is stale and nothing else would tell
 * the dashboard. Mount and `refreshAllData` are the only other scan triggers,
 * so without this the user would have to navigate away and back to see it.
 *
 * `cancelActiveListeners` collapses a burst of deletes into one trailing scan.
 * The scan drains any queued prune on the main side before reading, so it
 * reports the settled lock rather than racing the eviction it is waiting on.
 */
listenerMiddleware.startListening({
  actionCreator: setUndoToast,
  effect: async (action, listenerApi) => {
    // Unlink toasts tombstone nothing, so no eviction and no prune follows.
    if (action.payload.kind !== 'delete') return
    listenerApi.cancelActiveListeners()
    await listenerApi.delay(UNDO_WINDOW_MS + LOCK_RESCAN_GRACE_MS)
    void listenerApi.dispatch(fetchStaleLockEntries())
  },
})
