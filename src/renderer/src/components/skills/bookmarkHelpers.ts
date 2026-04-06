import type { Skill } from '../../../../shared/types'

/**
 * Whether a skill can be bookmarked (has repo source info).
 * Local skills have no source and cannot be reinstalled from a repo.
 * @param skill - Installed skill
 * @returns true if skill has source (non-local), false otherwise
 * @example
 * canBookmarkSkill({ source: 'pbakaus/impeccable', ... }) // => true
 * canBookmarkSkill({ source: undefined, ... })            // => false
 */
export function canBookmarkSkill(skill: Skill): boolean {
  return skill.source !== undefined && skill.source !== ''
}

/**
 * Maps installed Skill to BookmarkedSkill data (repo + url).
 * Derives url from sourceUrl (strips .git suffix) or falls back to GitHub URL.
 * @param skill - Installed skill with source
 * @returns { repo, url } for addBookmark action
 * @example
 * skillToBookmarkData({ source: 'pbakaus/impeccable', sourceUrl: 'https://github.com/pbakaus/impeccable.git' })
 * // => { repo: 'pbakaus/impeccable', url: 'https://github.com/pbakaus/impeccable' }
 * skillToBookmarkData({ source: 'laststance/skills', sourceUrl: undefined })
 * // => { repo: 'laststance/skills', url: 'https://github.com/laststance/skills' }
 */
export function skillToBookmarkData(skill: Skill): {
  repo: string
  url: string
} {
  const repo = skill.source ?? ''
  const url = skill.sourceUrl
    ? skill.sourceUrl.replace(/\.git$/, '')
    : `https://github.com/${repo}`
  return { repo, url }
}
