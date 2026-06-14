import type { Settings, SettingsPatch } from './settings'
import type {
  AbsolutePath,
  Agent,
  BulkDeleteResult,
  BulkUnlinkResult,
  ClearOrphanSymlinksOptions,
  ClearOrphanSymlinksResult,
  ClearBrokenSymlinkSlotsOptions,
  ClearBrokenSymlinkSlotsResult,
  CliCommandOperationResult,
  CliCommandResult,
  CliCommandStatus,
  CopyToAgentsOptions,
  CopyToAgentsResult,
  CreateSymlinksOptions,
  CreateSymlinksResult,
  DeleteProgressPayload,
  DeleteSkillOptions,
  DeleteSkillResult,
  DeleteSkillsOptions,
  DownloadProgress,
  FolderActionResult,
  HttpUrl,
  InstallOptions,
  InstallProgress,
  PixelHeight,
  PixelWidth,
  RankingFilter,
  RemoveAllFromAgentOptions,
  RemoveAllFromAgentResult,
  RestoreDeletedSkillOptions,
  RestoreDeletedSkillResult,
  SearchQuery,
  Skill,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
  SkillSearchResult,
  SourceStats,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewOptions,
  SyncPreviewResult,
  UnlinkFromAgentOptions,
  UnlinkManyFromAgentOptions,
  UnlinkResult,
  UpdateErrorPayload,
  UpdateInfo,
} from './types'

/**
 * Contract mapping IPC invoke channels to their argument tuples and return types.
 * Both main-process handlers (typedHandle) and preload callers (typedInvoke)
 * are statically checked against this single source of truth.
 * @example
 * // Main process:
 * typedHandle('skills:getAll', async () => scanSkills())
 * // Preload:
 * typedInvoke('skills:getAll') // Promise<Skill[]>
 */
export interface IpcInvokeContract {
  'skills:getAll': { args: []; result: Skill[] }
  'skills:unlinkFromAgent': {
    args: [UnlinkFromAgentOptions]
    result: UnlinkResult
  }
  'skills:removeAllFromAgent': {
    args: [RemoveAllFromAgentOptions]
    result: RemoveAllFromAgentResult
  }
  'skills:deleteSkill': {
    args: [DeleteSkillOptions]
    result: DeleteSkillResult
  }
  'skills:createSymlinks': {
    args: [CreateSymlinksOptions]
    result: CreateSymlinksResult
  }
  'skills:copyToAgents': {
    args: [CopyToAgentsOptions]
    result: CopyToAgentsResult
  }
  'skills:deleteSkills': {
    args: [DeleteSkillsOptions]
    result: BulkDeleteResult
  }
  'skills:clearOrphanSymlinks': {
    args: [ClearOrphanSymlinksOptions]
    result: ClearOrphanSymlinksResult
  }
  'skills:clearBrokenSymlinkSlots': {
    args: [ClearBrokenSymlinkSlotsOptions]
    result: ClearBrokenSymlinkSlotsResult
  }
  'skills:unlinkManyFromAgent': {
    args: [UnlinkManyFromAgentOptions]
    result: BulkUnlinkResult
  }
  'skills:restoreDeletedSkill': {
    args: [RestoreDeletedSkillOptions]
    result: RestoreDeletedSkillResult
  }
  'agents:getAll': { args: []; result: Agent[] }
  'source:getStats': { args: []; result: SourceStats }
  'files:list': { args: [AbsolutePath]; result: SkillFile[] }
  'files:read': { args: [AbsolutePath]; result: SkillFileContent | null }
  'files:readBinary': {
    args: [AbsolutePath]
    result: SkillBinaryContent | null
  }
  'skills:cli:search': { args: [SearchQuery]; result: SkillSearchResult[] }
  'skills:cli:install': { args: [InstallOptions]; result: CliCommandResult }
  'skills:cli:cancel': { args: []; result: void }
  'marketplace:leaderboard': {
    args: [{ filter: RankingFilter }]
    result: SkillSearchResult[]
  }
  'sync:preview': {
    // Always 1-arg (possibly `undefined`) to match the Zod tuple schema —
    // `z.tuple([...optional()])` accepts `[undefined]` but rejects `[]`.
    // Preload's `typedInvoke('sync:preview', options)` always forwards the
    // arg even when `options` is `undefined`, so this contract reflects
    // reality.
    args: [SyncPreviewOptions | undefined]
    result: SyncPreviewResult
  }
  'sync:execute': { args: [SyncExecuteOptions]; result: SyncExecuteResult }
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void }
  'update:check': { args: []; result: void }
  'shell:openExternal': { args: [HttpUrl]; result: void }
  'cliCommand:getStatus': { args: []; result: CliCommandStatus }
  'cliCommand:install': { args: []; result: CliCommandOperationResult }
  'cliCommand:remove': { args: []; result: CliCommandOperationResult }
  'settings:open': { args: []; result: void }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [SettingsPatch]; result: Settings }
  // Folder actions are intentionally typed as `Promise<FolderActionResult>`
  // (never throws) so the renderer can render a toast without try/catch.
  // Main-process exceptions get caught at the typedHandle boundary and
  // converted to `{ ok: false, reason: 'launch-failed', message }`.
  'folder:revealInFinder': { args: [AbsolutePath]; result: FolderActionResult }
  'folder:openInTerminal': { args: [AbsolutePath]; result: FolderActionResult }
  // Returns the *content* bounds of the live main window — `null` when the
  // window has been closed/destroyed. Settings → "Use current window size"
  // calls this and writes the result into `settings.windowSize`.
  'window:getMainBounds': {
    args: []
    result: { width: PixelWidth; height: PixelHeight } | null
  }
}

/**
 * Contract mapping IPC event channels (one-way, main -> renderer) to their payload types.
 * Used for push notifications like update progress and CLI install progress.
 * @example
 * // Main process sends:
 * win.webContents.send('update:available', { version: '1.2.0' })
 * // Renderer listens:
 * ipcRenderer.on('update:available', (_, info) => ...)
 */
export interface IpcEventContract {
  'skills:cli:progress': InstallProgress
  'skills:deleteProgress': DeleteProgressPayload
  'update:checking': void
  'update:available': UpdateInfo
  'update:not-available': void
  'update:progress': DownloadProgress
  'update:downloaded': UpdateInfo
  'update:error': UpdateErrorPayload
  'settings:changed': Settings
}

/** Union of every request/response IPC invoke channel name in {@link IpcInvokeContract}. */
export type IpcInvokeChannel = keyof IpcInvokeContract
/** Union of every one-way (main → renderer) IPC event channel name in {@link IpcEventContract}. */
export type IpcEventChannel = keyof IpcEventContract
