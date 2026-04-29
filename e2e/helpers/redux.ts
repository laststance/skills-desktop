import type { Page } from '@playwright/test'

/**
 * Read a slice of the renderer's Redux store via `page.evaluate`.
 * Throws on the test side (not the renderer) when the store isn't exposed,
 * which usually means the bundle was built without `E2E_BUILD=1`.
 *
 * @example
 * const tab = await getStoreState(page, (state: any) => state.ui.activeTab)
 */
export async function getStoreState<T>(
  page: Page,
  selector: (state: unknown) => T,
): Promise<T> {
  return page.evaluate(
    ({ selectorSrc }) => {
      const store = window.__store__ ?? window.__store
      if (!store) {
        throw new Error(
          'window.__store__ is not exposed. Did you build with E2E_BUILD=1?',
        )
      }
      const fn = new Function('state', `return (${selectorSrc})(state)`) as (
        state: unknown,
      ) => unknown
      return fn(store.getState())
    },
    { selectorSrc: selector.toString() },
  ) as Promise<T>
}

/**
 * Wait until `state.skills.selectedSkillNames.length === count`. Useful after
 * tab/agent switches that should clear selection (regression 2f05684).
 */
export async function waitForSelectionCount(
  page: Page,
  count: number,
  timeoutMs = 5_000,
): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        skills?: { selectedSkillNames?: unknown[] }
      }
      return state.skills?.selectedSkillNames?.length === expected
    },
    count,
    { timeout: timeoutMs },
  )
}

/**
 * Snapshot the recorded IPC events. Returns events in chronological order.
 * Throws if `__ipcEvents__` is not exposed (build flag mismatch).
 */
export async function getIpcEvents(
  page: Page,
): Promise<Array<{ channel: string; data: unknown; timestamp: number }>> {
  return page.evaluate(() => {
    if (!window.__ipcEvents__) {
      throw new Error(
        'window.__ipcEvents__ is not exposed. Did you build with E2E_BUILD=1?',
      )
    }
    return window.__ipcEvents__.list()
  })
}

/** Clear the IPC event recorder. Call before triggering a flow you want to assert against. */
export async function clearIpcEvents(page: Page): Promise<void> {
  await page.evaluate(() => window.__ipcEvents__?.clear())
}

/**
 * Refresh `state.skills.items` from disk. Used after specs that mutate the
 * filesystem via direct IPC calls (bypassing thunks), since the IPC handlers
 * do not push back into the renderer store on their own.
 *
 * Internally calls `skills:getAll` and dispatches a synthetic
 * `skills/fetchAll/fulfilled` action so the slice's existing reducer applies
 * the payload — equivalent in effect to dispatching the `fetchSkills` thunk.
 */
export async function refreshSkillsState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const skills = await window.electron.skills.getAll()
    const store = window.__store__ ?? window.__store
    if (!store) {
      throw new Error(
        'window.__store__ is not exposed. Did you build with E2E_BUILD=1?',
      )
    }
    store.dispatch({
      type: 'skills/fetchAll/fulfilled',
      payload: skills,
      meta: { requestId: 'e2e-refresh', requestStatus: 'fulfilled' },
    })
  })
}
