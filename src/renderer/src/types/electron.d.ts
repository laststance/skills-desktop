import type {
  Skill,
  Agent,
  SymlinkInfo,
  SourceStats,
  SymlinkStatus,
  SkillFile,
  SkillFileContent,
  UpdateInfo,
  DownloadProgress,
  SkillSearchResult,
  InstallOptions,
  CliCommandResult,
  InstallProgress,
  UnlinkFromAgentOptions,
  UnlinkResult,
  RemoveAllFromAgentOptions,
  RemoveAllFromAgentResult,
  DeleteSkillOptions,
  DeleteSkillResult,
  CreateSymlinksOptions,
  CreateSymlinksResult,
  SyncPreviewResult,
  SyncExecuteOptions,
  SyncExecuteResult,
} from '../../../shared/types'

declare global {
  interface Window {
    electron: {
      shell: {
        openExternal: (url: string) => Promise<void>
      }
      skills: {
        getAll: () => Promise<Skill[]>
        getOne: (name: string) => Promise<Skill | null>
        unlinkFromAgent: (
          options: UnlinkFromAgentOptions,
        ) => Promise<UnlinkResult>
        removeAllFromAgent: (
          options: RemoveAllFromAgentOptions,
        ) => Promise<RemoveAllFromAgentResult>
        deleteSkill: (options: DeleteSkillOptions) => Promise<DeleteSkillResult>
        createSymlinks: (
          options: CreateSymlinksOptions,
        ) => Promise<CreateSymlinksResult>
      }
      agents: {
        getAll: () => Promise<Agent[]>
        getSymlinks: (skillName: string) => Promise<SymlinkInfo[]>
      }
      source: {
        getStats: () => Promise<SourceStats>
      }
      symlink: {
        check: (skillName: string, agentId: string) => Promise<SymlinkStatus>
      }
      files: {
        list: (skillPath: string) => Promise<SkillFile[]>
        read: (filePath: string) => Promise<SkillFileContent | null>
      }
      update: {
        // Event listeners - return cleanup function
        onChecking: (callback: () => void) => () => void
        onAvailable: (callback: (info: UpdateInfo) => void) => () => void
        onNotAvailable: (callback: () => void) => () => void
        onProgress: (
          callback: (progress: DownloadProgress) => void,
        ) => () => void
        onDownloaded: (callback: (info: UpdateInfo) => void) => () => void
        onError: (callback: (error: { message: string }) => void) => () => void
        // Actions
        download: () => Promise<void>
        install: () => Promise<void>
        check: () => Promise<void>
      }
      skillsCli: {
        search: (query: string) => Promise<SkillSearchResult[]>
        install: (options: InstallOptions) => Promise<CliCommandResult>
        remove: (skillName: string) => Promise<CliCommandResult>
        cancel: () => Promise<void>
        onProgress: (
          callback: (progress: InstallProgress) => void,
        ) => () => void
      }
      sync: {
        preview: () => Promise<SyncPreviewResult>
        execute: (options: SyncExecuteOptions) => Promise<SyncExecuteResult>
      }
    }
  }
}

export {}
