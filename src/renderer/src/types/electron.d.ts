import type {
  Skill,
  Agent,
  SourceStats,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
  UpdateInfo,
  DownloadProgress,
  RankingFilter,
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
  DeleteSkillsOptions,
  BulkDeleteResult,
  UnlinkManyFromAgentOptions,
  BulkUnlinkResult,
  RestoreDeletedSkillOptions,
  RestoreDeletedSkillResult,
  CopyToAgentsOptions,
  CopyToAgentsResult,
  CreateSymlinksOptions,
  CreateSymlinksResult,
  SyncPreviewResult,
  SyncExecuteOptions,
  SyncExecuteResult,
} from '../../../shared/types'

/** Event payload shape for the \`skills:deleteProgress\` channel — emitted by main during serial batch delete when total >= 10. */
interface DeleteProgressPayload {
  current: number
  total: number
}

declare global {
  interface Window {
    electron: {
      shell: {
        openExternal: (url: string) => Promise<void>
      }
      skills: {
        getAll: () => Promise<Skill[]>
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
        copyToAgents: (
          options: CopyToAgentsOptions,
        ) => Promise<CopyToAgentsResult>
        // Bulk delete + undo.
        deleteSkills: (
          options: DeleteSkillsOptions,
        ) => Promise<BulkDeleteResult>
        unlinkManyFromAgent: (
          options: UnlinkManyFromAgentOptions,
        ) => Promise<BulkUnlinkResult>
        restoreDeletedSkill: (
          options: RestoreDeletedSkillOptions,
        ) => Promise<RestoreDeletedSkillResult>
        // One-way push — fires when \`total >= 10\` during batch delete so the
        // toolbar can render a live counter.
        onDeleteProgress: (
          callback: (payload: DeleteProgressPayload) => void,
        ) => () => void
      }
      agents: {
        getAll: () => Promise<Agent[]>
      }
      source: {
        getStats: () => Promise<SourceStats>
      }
      files: {
        list: (skillPath: string) => Promise<SkillFile[]>
        read: (filePath: string) => Promise<SkillFileContent | null>
        readBinary: (filePath: string) => Promise<SkillBinaryContent | null>
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
      marketplace: {
        leaderboard: (options: {
          filter: RankingFilter
        }) => Promise<SkillSearchResult[]>
      }
      sync: {
        preview: () => Promise<SyncPreviewResult>
        execute: (options: SyncExecuteOptions) => Promise<SyncExecuteResult>
      }
    }
  }
}

export {}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          preload?: string
          allowpopups?: boolean
        },
        HTMLElement
      >
    }
  }
}
