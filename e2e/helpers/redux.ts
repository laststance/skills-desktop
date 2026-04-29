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
 * Wait until `state.skills.selection.length === count`. Useful after
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
      const state = store.getState() as { skills?: { selection?: unknown[] } }
      return state.skills?.selection?.length === expected
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
