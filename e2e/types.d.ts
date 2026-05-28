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
  interface FilesystemEntryIdentity {
    kind: 'directory' | 'symlink' | 'file' | 'other'
    dev: number
    ino: number
    size: number
    ctimeMs: number
    mtimeMs: number
  }

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
        deleteSkill: (options: {
          skillName: string
          skillPath: string
          filesystemIdentity: FilesystemEntryIdentity
        }) => Promise<{
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
          items: Array<{
            skillName: string
            skillPath: string
            filesystemIdentity: FilesystemEntryIdentity
          }>
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
                outcome: 'orphan-cleared'
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
        clearOrphanSymlinks: (options: {
          items: Array<{
            skillName: string
            agents: Array<{
              agentId: string
              linkPath: string
              targetPath: string
            }>
          }>
        }) => Promise<{
          items: Array<
            | {
                skillName: string
                outcome: 'orphan-cleared'
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
        clearBrokenSymlinkSlots: (options: {
          items: Array<{
            agentId: string
            linkName: string
            linkPath: string
            targetPath: string
          }>
        }) => Promise<{
          items: Array<
            | {
                agentId: string
                skillName: string
                linkPath: string
                outcome: 'unlinked'
              }
            | {
                agentId: string
                skillName: string
                linkPath: string
                outcome: 'error'
                error: { message: string; code?: string }
              }
          >
        }>
        unlinkFromAgent: (options: {
          skillName: string
          agentId: string
          linkPath: string
          targetPath?: string
          confirmedLocalDirectoryDelete?: boolean
          reviewedDirectoryIdentity?: FilesystemEntryIdentity
        }) => Promise<{ success: boolean; error?: string }>
        unlinkManyFromAgent: (options: {
          agentId: string
          items: Array<{
            skillName: string
            linkPath: string
            targetPath: string
          }>
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
          filesystemIdentity: FilesystemEntryIdentity
        }) => Promise<{
          success: boolean
          removedCount: number
          error?: string
        }>
      }
      agents: {
        getAll: () => Promise<unknown[]>
      }
      /**
       * Settings IPC. The `set` argument is intentionally typed as
       * `Record<string, unknown>` (NOT `Partial<Settings>`) because the
       * hide-agents suite directly tests the strict-enum boundary at
       * `IPC_ARG_SCHEMAS['settings:set']` by passing values the renderer's
       * type system would normally reject. A tighter type here would
       * force every such test to add an `as unknown as ...` escape hatch.
       */
      settings: {
        get: () => Promise<unknown>
        set: (partial: Record<string, unknown>) => Promise<unknown>
      }
      /**
       * Sync IPC. Both methods return rich result objects; the spec types
       * them via local cast at the call site so this surface stays as
       * `unknown` here — keeping the surface narrow protects the test
       * suite from drift in the production `SyncPreviewResult` /
       * `SyncExecuteResult` shapes (which evolve with feature work).
       */
      sync: {
        preview: (options?: { agentId?: string }) => Promise<unknown>
        execute: (options: {
          replaceConflicts: string[]
          agentId?: string
        }) => Promise<unknown>
      }
    }
  }
}

export {}
