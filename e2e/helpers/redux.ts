import type { Page } from '@playwright/test'

/**
 * Action type that the `skillsSlice` `fetchAll` thunk dispatches on success.
 *
 * This is duplicated from `src/renderer/src/store/skillsSlice.ts` because
 * `helpers/*` runs in the Playwright Node context — it cannot import the
 * renderer bundle. Keeping the literal in one place (here) gives `grep`-able
 * coupling: if the slice ever renames the thunk, the only spot a stale
 * literal lingers is this constant.
 *
 * @see refreshSkillsState for the consumer.
 */
const SKILLS_FETCH_ALL_FULFILLED_TYPE = 'skills/fetchAll/fulfilled'

/**
 * Read a slice of the renderer's Redux store via `page.evaluate`.
 * Throws on the test side (not the renderer) when the store isn't exposed,
 * which usually means the bundle was built without `E2E_BUILD=1`.
 *
 * Selector errors are wrapped with the source string + the failing message
 * so a TypeError like `Cannot read properties of undefined (reading 'items')`
 * surfaces alongside the actual selector body in the test failure output.
 * Without this wrapping the error lands as a generic Playwright eval failure
 * and the spec author has to re-derive which selector blew up.
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
      try {
        return fn(store.getState())
      } catch (selectorError) {
        const errorMessage =
          selectorError instanceof Error
            ? selectorError.message
            : String(selectorError)
        throw new Error(
          `getStoreState selector threw: ${errorMessage}\nselector source:\n${selectorSrc}`,
        )
      }
    },
    { selectorSrc: selector.toString() },
  ) as Promise<T>
}

/**
 * Read the refreshed symlink status for `skillName` against `agentId` directly
 * from the renderer store. Used by Phase-2 specs after `refreshSkillsState` to
 * confirm an IPC-driven mutation (copy / unlink) propagated correctly.
 *
 * Returns `undefined` when the skill is not present in the store OR the agent
 * has no symlink entry — both shapes are legitimate inputs depending on test
 * setup, so the caller should compare against the expected literal
 * (`'valid' | 'broken' | 'missing' | undefined`) rather than `?.toBe('valid')`.
 *
 * Closure-capture rules apply (see `getStoreState` doc): both `skillName` and
 * `agentId` are passed via the second `evaluate` argument — module-level
 * constants in the caller would be erased by `Function.toString`.
 *
 * @example
 * const status = await getRefreshedSymlinkStatus(appWindow, 'azure-ai', 'cursor')
 * expect(status).toBe('valid')
 */
export async function getRefreshedSymlinkStatus(
  page: Page,
  skillName: string,
  agentId: string,
): Promise<string | undefined> {
  return page.evaluate(
    ({ skillNameLiteral, agentIdLiteral }) => {
      const store = window.__store__ ?? window.__store
      const state = store?.getState() as
        | {
            skills?: {
              items?: Array<{
                name: string
                symlinks?: Array<{ agentId: string; status: string }>
              }>
            }
          }
        | undefined
      const skill = state?.skills?.items?.find(
        (item) => item.name === skillNameLiteral,
      )
      return skill?.symlinks?.find(
        (symlink) => symlink.agentId === agentIdLiteral,
      )?.status
    },
    { skillNameLiteral: skillName, agentIdLiteral: agentId },
  )
}

/**
 * Wait until the renderer's initial filesystem scan has populated both
 * `skills.items` and `agents.items`. The fetchSkills + fetchAgents thunks
 * fire on mount, but assertions against the store race the empty initial
 * state until both lists are non-empty.
 *
 * Default 10s matches the pre-extraction inline timeout and leaves macOS CI
 * headroom for the npm-resolved skills CLI scan.
 *
 * @example
 * await waitForInitialScan(appWindow)
 */
export async function waitForInitialScan(
  page: Page,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        skills?: { items?: unknown[] }
        agents?: { items?: unknown[] }
      }
      return Boolean(state.skills?.items?.length && state.agents?.items?.length)
    },
    undefined,
    { timeout: timeoutMs },
  )
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

/**
 * Clear the IPC event recorder. Call before triggering a flow you want to
 * assert against. Throws if `__ipcEvents__` is not exposed (build-flag
 * mismatch) — same contract as `getIpcEvents` so a missing recorder fails
 * loud at the call site instead of silently no-op'ing and producing an
 * empty assertion downstream.
 */
export async function clearIpcEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!window.__ipcEvents__) {
      throw new Error(
        'window.__ipcEvents__ is not exposed. Did you build with E2E_BUILD=1?',
      )
    }
    window.__ipcEvents__.clear()
  })
}

/**
 * Refresh `state.skills.items` from disk. Used after specs that mutate the
 * filesystem via direct IPC calls (bypassing thunks), since the IPC handlers
 * do not push back into the renderer store on their own.
 *
 * Internally calls `skills:getAll` and dispatches a synthetic
 * `SKILLS_FETCH_ALL_FULFILLED_TYPE` action so the slice's existing reducer
 * applies the payload — equivalent in effect to dispatching the `fetchSkills`
 * thunk. The action type literal is centralized at the top of this file so
 * future renames in `skillsSlice` only need to update one place.
 */
export async function refreshSkillsState(page: Page): Promise<void> {
  await page.evaluate(
    async ({ actionType }) => {
      const skills = await window.electron.skills.getAll()
      const store = window.__store__ ?? window.__store
      if (!store) {
        throw new Error(
          'window.__store__ is not exposed. Did you build with E2E_BUILD=1?',
        )
      }
      store.dispatch({
        type: actionType,
        payload: skills,
        meta: { requestId: 'e2e-refresh', requestStatus: 'fulfilled' },
      })
    },
    { actionType: SKILLS_FETCH_ALL_FULFILLED_TYPE },
  )
}
