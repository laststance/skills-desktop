import type {
  Skill,
  Agent,
  SymlinkInfo,
  SourceStats,
  SymlinkStatus,
  SkillFile,
  SkillFileContent,
} from '../../../shared/types'

declare global {
  interface Window {
    electron: {
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
    }
  }
}

export {}
