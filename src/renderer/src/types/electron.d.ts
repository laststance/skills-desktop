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
    }
  }
}

export {}
