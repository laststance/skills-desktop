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
      }
    }
  }
}

export {}
