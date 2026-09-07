import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import {
  repositoryId,
  semanticVersion,
  toAgentCount,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toHttpUrl,
  toHumanFileSize,
  toInstallCount,
  toIsoTimestamp,
  toLineCount,
  toPosixRelativePath,
  toSkillCount,
  toSkillRank,
  toSymlinkCount,
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
    skillCount: toSkillCount(8),
    localSkillCount: toSkillCount(1),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    path: '/Users/raphtalia/.cursor/skills',
    exists: true,
    skillCount: toSkillCount(6),
    localSkillCount: toSkillCount(0),
  },
  {
    id: 'codex',
    name: 'Codex',
    path: '/Users/raphtalia/.codex/skills',
    exists: true,
    skillCount: toSkillCount(5),
    localSkillCount: toSkillCount(2),
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    path: '/Users/raphtalia/.gemini/skills',
    exists: false,
    skillCount: toSkillCount(0),
    localSkillCount: toSkillCount(0),
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
    symlinkCount: toSymlinkCount(3),
    isSource: true,
    isOrphan: false,
    source: repositoryId('laststance/gstack'),
    sourceUrl: toHttpUrl('https://github.com/laststance/gstack'),
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
    symlinkCount: toSymlinkCount(2),
    isSource: true,
    isOrphan: false,
    source: repositoryId('laststance/gstack'),
    sourceUrl: toHttpUrl('https://github.com/laststance/gstack'),
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
    symlinkCount: toSymlinkCount(0),
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
    symlinkCount: toSymlinkCount(0),
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
    rank: toSkillRank(1),
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: toHttpUrl('https://skills.sh/task'),
    installCount: toInstallCount(2480),
  },
  {
    rank: toSkillRank(2),
    name: 'browser-use',
    repo: repositoryId('browser-use/skills'),
    url: toHttpUrl('https://skills.sh/browser-use'),
    installCount: toInstallCount(1630),
  },
  {
    rank: toSkillRank(3),
    name: 'code-review',
    repo: repositoryId('laststance/gstack'),
    url: toHttpUrl('https://skills.sh/code-review'),
    installCount: toInstallCount(820),
  },
  {
    rank: toSkillRank(4),
    name: 'azure-ai',
    repo: repositoryId('microsoft/azure-skills'),
    url: toHttpUrl('https://skills.sh/azure-ai'),
    installCount: toInstallCount(312),
  },
]

export const storyBookmarks: BookmarkedSkill[] = [
  {
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: toHttpUrl('https://skills.sh/task'),
    bookmarkedAt: toIsoTimestamp(now),
  },
  {
    name: 'browser-use',
    repo: repositoryId('browser-use/skills'),
    url: toHttpUrl('https://skills.sh/browser-use'),
    bookmarkedAt: toIsoTimestamp(now),
  },
]

export const storySourceStats: SourceStats = {
  path: '/Users/raphtalia/.agents/skills',
  skillCount: toSkillCount(storySkills.length),
  totalSize: toHumanFileSize('4.8 MB'),
  lastModified: toIsoTimestamp(now),
}

export const storySkillFiles: SkillFile[] = [
  {
    name: toFileName('SKILL.md'),
    path: '/Users/raphtalia/.agents/skills/design-review/SKILL.md',
    relativePath: toPosixRelativePath('SKILL.md'),
    extension: toFileExtension('.md'),
    size: toFileSizeBytes(2048),
    previewable: 'text',
  },
  {
    name: toFileName('qa.md'),
    path: '/Users/raphtalia/.agents/skills/design-review/references/qa.md',
    relativePath: toPosixRelativePath('references/qa.md'),
    extension: toFileExtension('.md'),
    size: toFileSizeBytes(1024),
    previewable: 'text',
  },
  {
    name: toFileName('diagram.png'),
    path: '/Users/raphtalia/.agents/skills/design-review/assets/diagram.png',
    relativePath: toPosixRelativePath('assets/diagram.png'),
    extension: toFileExtension('.png'),
    size: toFileSizeBytes(9280),
    previewable: 'image',
  },
]

export const storySkillFileContent: SkillFileContent = {
  name: toFileName('SKILL.md'),
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
  extension: toFileExtension('.md'),
  lineCount: toLineCount(10),
}

export const storySyncPreview: SyncPreviewResult = {
  totalSkills: toSkillCount(4),
  totalAgents: toAgentCount(3),
  toCreate: toSymlinkCount(3),
  alreadySynced: toSymlinkCount(8),
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
  created: toSymlinkCount(2),
  replaced: toSymlinkCount(1),
  skipped: toSymlinkCount(7),
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
