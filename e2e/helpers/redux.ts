import type { Page } from '@playwright/test'

/**
 * Action type that the `skillsSlice` `fetchAll` thunk dispatches on success.
 *
 * Kept in the Playwright helper because `helpers/*` runs in Node and cannot
 * import the renderer bundle; one literal keeps thunk renames grep-able.
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
 * Closure capture caveat: the selector is serialized via `Function.toString`
 * and re-evaluated in the renderer, so it CANNOT reference variables from
 * the surrounding test scope (those become `ReferenceError: x is not
 * defined` at runtime). Pass dynamic values through the third `args`
 * parameter — they're sent over the wire and arrive as the selector's
 * second positional argument.
 *
 * @example
 * const tab = await getStoreState(page, (state: any) => state.ui.activeTab)
 * @example
 * // Closure-safe: pass dynamic values via `args`
 * const present = await getStoreState(
 *   page,
 *   (state, name) => {
 *     const root = state as { skills: { items: Array<{ name: string }> } }
 *     return root.skills.items.some((s) => s.name === name)
 *   },
 *   skillName,
 * )
 */
export async function getStoreState<T, A = undefined>(
  page: Page,
  selector: (state: unknown, args: A) => T,
  args?: A,
): Promise<T> {
  return page.evaluate(
    ({ selectorSrc, selectorArgs }) => {
      const store = window.__store__ ?? window.__store
      if (!store) {
        throw new Error(
          'window.__store__ is not exposed. Did you build with E2E_BUILD=1?',
        )
      }
      // Test selectors are trusted code passed by specs; dynamic rebuild is
      // what preserves helpful selector-source errors across the browser wall.
      // react-doctor-disable-next-line react-doctor/no-eval
      const fn = new Function(
        'state',
        'args',
        `return (${selectorSrc})(state, args)`,
      ) as (state: unknown, args: unknown) => unknown
      try {
        return fn(store.getState(), selectorArgs)
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
    { selectorSrc: selector.toString(), selectorArgs: args },
  ) as Promise<T>
}

/**
 * Read the refreshed symlink status for `skillName` against `agentId` directly
 * from the renderer store. Used by IPC specs after `refreshSkillsState` to
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
 * Why 10s and not less?
 *   - Local dev p50 ≈ 250ms (render boot + 2 IPC roundtrips against an
 *     empty agent dir). p99 ≈ 1s when the snapshot HOME has all 7
 *     azure-* skills × 21 agents to scan.
 *   - GitHub Actions macOS-13 runners under load (4-job matrix concurrent)
 *     show a 3-5× slowdown vs local. Empirical p99 sits around 3-4s.
 *   - 10s leaves 2-3× headroom over measured CI p99 to absorb a slow
 *     cold-start of `RUN_E2E=1 pnpm build` artifacts on a stressed runner.
 *   - Setting `E2E_TIMING=1` exports the actual elapsed millis to a
 *     console line tagged `[e2e:timing] waitForInitialScan=...ms` so a
 *     future operator can re-aggregate p99 from CI logs without touching
 *     call sites. Tighten the default to 5s once a meaningful sample of
 *     measurements (≥50 successful CI runs) confirms p99 <2s.
 *   - Tightening below 5s would buy ~3s of saved time on a SUITE-wide
 *     timeout that almost never fires; any savings are dwarfed by the
 *     suite-level Playwright timeout. Premature tightening would
 *     re-introduce flake on first slow CI runner without operational
 *     benefit.
 *
 * @example
 * await waitForInitialScan(appWindow)
 * @example
 * // Measurement run, evidence for future tightening
 * E2E_TIMING=1 pnpm test:e2e
 */
export async function waitForInitialScan(
  page: Page,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now()
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
  // `E2E_TIMING=1` opt-in keeps the default test output unchanged while
  // letting CI runs export per-call latency for offline p99 analysis.
  // Logging only on opt-in avoids polluting failure-mode triage where
  // every console line costs reading time.
  if (process.env['E2E_TIMING'] === '1') {
    const elapsedMs = Date.now() - startedAt
    console.log(`[e2e:timing] waitForInitialScan=${elapsedMs}ms`)
  }
}

/**
 * Wait until the renderer's sync flow is settled — `state.ui.isSyncing`
 * has returned to `false` AND the relevant outcome slice is populated.
 *
 * Why a single helper with a discriminator instead of two functions: a
 * naive `isSyncing === false` poll resolves immediately because the slice
 * starts at `false` BEFORE the trigger ever fires (`fetchSyncPreview`
 * pending/`executeSyncAction` pending flip it to `true`). The race
 * window is tens of milliseconds in tests, so polling on the OUTCOME
 * (`syncPreview` for the preview phase, `syncResult` for the execute
 * phase) is the unambiguous signal.
 *
 * Both phases share the same slice flag, so a single helper with the
 * `expects` discriminator avoids duplication while keeping the failure
 * message specific to the phase under test ("expected syncResult, found
 * null after 10s" pinpoints the failed assertion better than a generic
 * "isSyncing" timeout).
 *
 * @param page - The Playwright page
 * @param expects - Which slice to wait for. `'preview'` for
 *                  `fetchSyncPreview`, `'result'` for `executeSyncAction`
 * @param timeoutMs - Poll timeout (default 10s, matches `waitForInitialScan`)
 * @example
 * await dispatchPreview(appWindow)
 * await waitForSyncSettled(appWindow, 'preview')
 * @example
 * await clickDialogSync(appWindow)
 * await waitForSyncSettled(appWindow, 'result')
 */
export async function waitForSyncSettled(
  page: Page,
  expects: 'preview' | 'result' = 'preview',
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (expectsLiteral) => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        ui?: {
          syncPreview?: unknown
          syncResult?: unknown
          isSyncing?: boolean
        }
      }
      if (state.ui?.isSyncing !== false) return false
      if (expectsLiteral === 'preview') return Boolean(state.ui?.syncPreview)
      return Boolean(state.ui?.syncResult)
    },
    expects,
    { timeout: timeoutMs },
  )
}

/**
 * Wait until `state.skills.selectedSkillNames.length === count`. Useful after
 * tab/agent switches that should clear selection (regression 2f05684).
 *
 * @example
 * await waitForSelectionCount(appWindow, 0)
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
 * Synchronously read `state.skills.selectedSkillNames.length`. Pair with
 * `waitForSelectionCount` when the assertion is *stability* (the listener
 * should NOT have cleared) rather than eventual consistency.
 *
 * @example
 * expect(await getSelectionCount(appWindow)).toBe(1)
 */
export async function getSelectionCount(page: Page): Promise<number> {
  return getStoreState(page, (state) => {
    const root = state as { skills: { selectedSkillNames: string[] } }
    return root.skills.selectedSkillNames.length
  })
}

/**
 * Dispatch a Redux action against the renderer store. Throws when the store
 * is not exposed, mirroring `getStoreState`'s contract — a test against a
 * non-E2E build should fail loud, not silently no-op.
 *
 * @param action - Plain serializable action; thunks are not supported
 *                 (use `evaluate` directly when you need lifecycle dispatch).
 *
 * @example
 * await dispatchAction(appWindow, { type: 'skills/toggleSelection', payload: 'azure-ai' })
 * @example
 * await dispatchAction(appWindow, {
 *   type: 'ui/fetchSyncPreview/pending',
 *   meta: { requestId: 'e2e-x', requestStatus: 'pending' },
 * })
 */
export async function dispatchAction(
  page: Page,
  action: { type: string; payload?: unknown; meta?: Record<string, unknown> },
): Promise<void> {
  await page.evaluate((actionLiteral) => {
    const store = window.__store__ ?? window.__store
    if (!store) {
      throw new Error(
        'window.__store__ is not exposed. Did you build with E2E_BUILD=1?',
      )
    }
    store.dispatch(actionLiteral)
  }, action)
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
