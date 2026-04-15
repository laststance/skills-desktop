import type {
  Agent,
  CliCommandResult,
  CopyToAgentsOptions,
  CopyToAgentsResult,
  CreateSymlinksOptions,
  CreateSymlinksResult,
  DeleteSkillOptions,
  DeleteSkillResult,
  DownloadProgress,
  InstallOptions,
  InstallProgress,
  RankingFilter,
  RemoveAllFromAgentOptions,
  RemoveAllFromAgentResult,
  Skill,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
  SkillSearchResult,
  SourceStats,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewResult,
  UnlinkFromAgentOptions,
  UnlinkResult,
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
  'agents:getAll': { args: []; result: Agent[] }
  'source:getStats': { args: []; result: SourceStats }
  'files:list': { args: [string]; result: SkillFile[] }
  'files:read': { args: [string]; result: SkillFileContent | null }
  'files:readBinary': { args: [string]; result: SkillBinaryContent | null }
  'skills:cli:search': { args: [string]; result: SkillSearchResult[] }
  'skills:cli:install': { args: [InstallOptions]; result: CliCommandResult }
  'skills:cli:remove': { args: [string]; result: CliCommandResult }
  'skills:cli:cancel': { args: []; result: void }
  'marketplace:leaderboard': {
    args: [{ filter: RankingFilter }]
    result: SkillSearchResult[]
  }
  'sync:preview': { args: []; result: SyncPreviewResult }
  'sync:execute': { args: [SyncExecuteOptions]; result: SyncExecuteResult }
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void }
  'update:check': { args: []; result: void }
  'shell:openExternal': { args: [string]; result: void }
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
  'update:checking': void
  'update:available': UpdateInfo
  'update:not-available': void
  'update:progress': DownloadProgress
  'update:downloaded': UpdateInfo
  'update:error': { message: string }
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcEventChannel = keyof IpcEventContract
