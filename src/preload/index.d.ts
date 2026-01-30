import type {
  Skill,
  Agent,
  SourceStats,
  SkillFile,
  SkillFileContent,
} from '../shared/types'

declare global {
  interface Window {
    electron: {
      shell: {
        openExternal: (url: string) => Promise<void>
      }
      skills: {
        getAll: () => Promise<Skill[]>
      }
      agents: {
        getAll: () => Promise<Agent[]>
      }
      source: {
        getStats: () => Promise<SourceStats>
      }
      files: {
        list: (skillPath: string) => Promise<SkillFile[]>
        read: (filePath: string) => Promise<SkillFileContent>
      }
    }
  }
}

export {}
