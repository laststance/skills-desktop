/**
 * Type augmentations for the renderer's `window` when the bundle was built
 * with `E2E_BUILD=1`. These let `page.evaluate(() => window.__store__)` etc.
 * type-check inside Playwright tests.
 */

interface RecordedIpcEvent {
  channel: string
  data: unknown
  timestamp: number
}

interface IpcEventsApi {
  list: () => RecordedIpcEvent[]
  clear: () => void
  count: (channel: string) => number
}

interface ExposedReduxAction {
  type: string
  payload?: unknown
  meta?: Record<string, unknown>
}

interface ExposedReduxStore {
  dispatch: (action: ExposedReduxAction) => unknown
  getState: () => unknown
  subscribe: (listener: () => void) => () => void
}

declare global {
  interface Window {
    __store?: ExposedReduxStore
    __store__?: ExposedReduxStore
    __ipcEvents__?: IpcEventsApi
    /**
     * Subset of the renderer's contextBridge surface used by E2E specs.
     * Mirrors the relevant shape of `src/renderer/src/types/electron.d.ts`
     * but avoids importing across tsconfig boundaries — only the channels
     * the suite drives are typed here.
     *
     * **Non-optional by contract.** The Playwright fixture only launches
     * builds produced with `E2E_BUILD=1`, and the contextBridge expose
     * happens unconditionally in `src/preload/index.ts:30`. Marking this
     * `electron?:` would force every `page.evaluate(... window.electron.X)`
     * call site to add optional chaining for a guarantee that already
     * holds — verbose with no diagnostic value. If the bridge ever fails
     * to mount, the spec fails on the first call with a clear "cannot
     * read properties of undefined" message that names the channel.
     */
    electron: {
      skills: {
        getAll: () => Promise<unknown[]>
        copyToAgents: (options: {
          skillName: string
          sourcePath: string
          targetAgentIds: string[]
        }) => Promise<{
          success: boolean
          copied: number
          failures: Array<{ agentId: string; error: string }>
        }>
        deleteSkill: (options: { skillName: string }) => Promise<{
          success: boolean
          symlinksRemoved: number
          cascadeAgents: string[]
          error?: string
        }>
        restoreDeletedSkill: (options: { tombstoneId: string }) => Promise<
          | {
              outcome: 'restored'
              symlinksRestored: number
              symlinksSkipped: number
            }
          | { outcome: 'error'; error: { message: string; code?: string } }
        >
        deleteSkills: (options: {
          items: Array<{ skillName: string }>
        }) => Promise<{
          items: Array<
            | {
                skillName: string
                outcome: 'deleted'
                tombstoneId: string
                symlinksRemoved: number
                cascadeAgents: string[]
              }
            | {
                skillName: string
                outcome: 'error'
                error: { message: string; code?: string }
              }
          >
        }>
        unlinkFromAgent: (options: {
          skillName: string
          agentId: string
          linkPath: string
        }) => Promise<{ success: boolean; error?: string }>
        unlinkManyFromAgent: (options: {
          agentId: string
          items: Array<{ skillName: string }>
        }) => Promise<{
          items: Array<
            | { skillName: string; outcome: 'unlinked' }
            | {
                skillName: string
                outcome: 'error'
                error: { message: string; code?: string }
              }
          >
        }>
        removeAllFromAgent: (options: {
          agentId: string
          agentPath: string
        }) => Promise<{
          success: boolean
          removedCount: number
          error?: string
        }>
      }
    }
  }
}

export {}
