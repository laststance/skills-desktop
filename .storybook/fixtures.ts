import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import {
  repositoryId,
  semanticVersion,
  tombstoneId,
  type Agent,
  type BookmarkedSkill,
  type Skill,
  type SkillFile,
  type SkillFileContent,
  type SkillSearchResult,
  type SourceStats,
  type SyncExecuteResult,
  type SyncPreviewResult,
  type UpdateInfo,
} from '@/shared/types'

const now = '2026-05-10T09:00:00.000Z'

/**
 * Agent matrix used by component stories.
 *
 * @returns Realistic installed and not-installed agent rows.
 * @example
 * storyAgents.filter((agent) => agent.exists)
 */
export const storyAgents: Agent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    path: '/Users/raphtalia/.claude/skills',
    exists: true,
    skillCount: 8,
    localSkillCount: 1,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    path: '/Users/raphtalia/.cursor/skills',
    exists: true,
    skillCount: 6,
    localSkillCount: 0,
  },
  {
    id: 'codex',
    name: 'Codex',
    path: '/Users/raphtalia/.codex/skills',
    exists: true,
    skillCount: 5,
    localSkillCount: 2,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    path: '/Users/raphtalia/.gemini/skills',
    exists: false,
    skillCount: 0,
    localSkillCount: 0,
  },
]

/**
 * Skill fixtures covering valid, broken, missing, local, and orphan states.
 *
 * @returns Skills whose symlink matrix exercises status colors and row actions.
 * @example
 * storySkills.find((skill) => skill.isOrphan)
 */
export const storySkills: Skill[] = [
  {
    name: 'design-review',
    description:
      'Designer-eye QA for spacing, hierarchy, interaction polish, and screenshots.',
    path: '/Users/raphtalia/.agents/skills/design-review',
    symlinkCount: 3,
    isSource: true,
    isOrphan: false,
    source: repositoryId('laststance/gstack'),
    sourceUrl: 'https://github.com/laststance/gstack',
    symlinks: [
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/Users/raphtalia/.agents/skills/design-review',
        linkPath: '/Users/raphtalia/.claude/skills/design-review',
        isLocal: false,
      },
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'valid',
        targetPath: '/Users/raphtalia/.agents/skills/design-review',
        linkPath: '/Users/raphtalia/.cursor/skills/design-review',
        isLocal: false,
      },
      {
        agentId: 'codex',
        agentName: 'Codex',
        status: 'valid',
        targetPath: '/Users/raphtalia/.agents/skills/design-review',
        linkPath: '/Users/raphtalia/.codex/skills/design-review',
        isLocal: false,
      },
    ],
  },
  {
    name: 'qa-electron',
    description:
      'Runs Electron UI verification through Playwright and the debug port.',
    path: '/Users/raphtalia/.agents/skills/qa-electron',
    symlinkCount: 2,
    isSource: true,
    isOrphan: false,
    source: repositoryId('laststance/gstack'),
    sourceUrl: 'https://github.com/laststance/gstack',
    symlinks: [
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/Users/raphtalia/.agents/skills/qa-electron',
        linkPath: '/Users/raphtalia/.claude/skills/qa-electron',
        isLocal: false,
      },
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'broken',
        targetPath: '/Users/raphtalia/.agents/skills/qa-electron',
        linkPath: '/Users/raphtalia/.cursor/skills/qa-electron',
        isLocal: false,
      },
      {
        agentId: 'codex',
        agentName: 'Codex',
        status: 'missing',
        linkPath: '/Users/raphtalia/.codex/skills/qa-electron',
        isLocal: false,
      },
    ],
  },
  {
    name: 'open-to-dia',
    description: 'Local macOS launcher skill for opening current URLs in Dia.',
    path: '/Users/raphtalia/.codex/skills/open-to-dia',
    symlinkCount: 0,
    isSource: false,
    isOrphan: false,
    symlinks: [
      {
        agentId: 'codex',
        agentName: 'Codex',
        status: 'valid',
        linkPath: '/Users/raphtalia/.codex/skills/open-to-dia',
        isLocal: true,
      },
    ],
  },
  {
    name: 'retired-skill',
    description: 'Source folder removed; remaining links need cleanup.',
    path: '/Users/raphtalia/.agents/skills/retired-skill',
    symlinkCount: 0,
    isSource: false,
    isOrphan: true,
    symlinks: [
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'broken',
        targetPath: '/Users/raphtalia/.agents/skills/retired-skill',
        linkPath: '/Users/raphtalia/.claude/skills/retired-skill',
        isLocal: false,
      },
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'broken',
        targetPath: '/Users/raphtalia/.agents/skills/retired-skill',
        linkPath: '/Users/raphtalia/.cursor/skills/retired-skill',
        isLocal: false,
      },
    ],
  },
]

/**
 * Marketplace data used by dashboard widgets and marketplace rows.
 *
 * @returns Ranked skill search results with install counts.
 * @example
 * storyMarketplaceSkills[0].repo
 */
export const storyMarketplaceSkills: SkillSearchResult[] = [
  {
    rank: 1,
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/task',
    installCount: 2480,
  },
  {
    rank: 2,
    name: 'browser-use',
    repo: repositoryId('browser-use/skills'),
    url: 'https://skills.sh/browser-use',
    installCount: 1630,
  },
  {
    rank: 3,
    name: 'code-review',
    repo: repositoryId('laststance/gstack'),
    url: 'https://skills.sh/code-review',
    installCount: 820,
  },
  {
    rank: 4,
    name: 'azure-ai',
    repo: repositoryId('microsoft/azure-skills'),
    url: 'https://skills.sh/azure-ai',
    installCount: 312,
  },
]

export const storyBookmarks: BookmarkedSkill[] = [
  {
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/task',
    bookmarkedAt: now,
  },
  {
    name: 'browser-use',
    repo: repositoryId('browser-use/skills'),
    url: 'https://skills.sh/browser-use',
    bookmarkedAt: now,
  },
]

export const storySourceStats: SourceStats = {
  path: '/Users/raphtalia/.agents/skills',
  skillCount: storySkills.length,
  totalSize: '4.8 MB',
  lastModified: now,
}

export const storySkillFiles: SkillFile[] = [
  {
    name: 'SKILL.md',
    path: '/Users/raphtalia/.agents/skills/design-review/SKILL.md',
    relativePath: 'SKILL.md',
    extension: '.md',
    size: 2048,
    previewable: 'text',
  },
  {
    name: 'qa.md',
    path: '/Users/raphtalia/.agents/skills/design-review/references/qa.md',
    relativePath: 'references/qa.md',
    extension: '.md',
    size: 1024,
    previewable: 'text',
  },
  {
    name: 'diagram.png',
    path: '/Users/raphtalia/.agents/skills/design-review/assets/diagram.png',
    relativePath: 'assets/diagram.png',
    extension: '.png',
    size: 9280,
    previewable: 'image',
  },
]

export const storySkillFileContent: SkillFileContent = {
  name: 'SKILL.md',
  content: [
    '---',
    'name: design-review',
    'description: Designer-eye QA for production UI',
    '---',
    '',
    '## Workflow',
    '',
    '1. Capture the interface.',
    '2. Mark hierarchy and spacing issues.',
    '3. Fix source and verify with screenshots.',
  ].join('\n'),
  extension: '.md',
  lineCount: 10,
}

export const storySyncPreview: SyncPreviewResult = {
  totalSkills: 4,
  totalAgents: 3,
  toCreate: 3,
  alreadySynced: 8,
  conflicts: [
    {
      skillName: 'qa-electron',
      agentId: 'cursor',
      agentName: 'Cursor',
      agentSkillPath: '/Users/raphtalia/.cursor/skills/qa-electron',
    },
  ],
}

export const storySyncResult: SyncExecuteResult = {
  success: false,
  created: 2,
  replaced: 1,
  skipped: 7,
  errors: [
    {
      path: '/Users/raphtalia/.cursor/skills/retired-skill',
      error: 'Broken symlink already removed',
    },
  ],
  details: [
    { skillName: 'design-review', agentName: 'Codex', action: 'created' },
    { skillName: 'qa-electron', agentName: 'Cursor', action: 'replaced' },
    { skillName: 'task', agentName: 'Claude Code', action: 'skipped' },
    {
      skillName: 'retired-skill',
      agentName: 'Cursor',
      action: 'error',
      error: 'Broken symlink already removed',
    },
  ],
}

export const storySettings: Settings = {
  ...DEFAULT_SETTINGS,
  hiddenAgentIds: ['cursor'],
}

export const storyUpdateInfo: UpdateInfo = {
  version: semanticVersion('0.17.0'),
  releaseNotes: 'Storybook polish and component coverage.',
}

export const storyTombstoneIds = [
  tombstoneId('1778371200000-design-review-a1b2c3d4'),
  tombstoneId('1778371200000-qa-electron-b5c6d7e8'),
]
