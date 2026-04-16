import type { HttpUrl, RepositoryId, Skill } from '../../../../shared/types'

/**
 * Whether a skill can be bookmarked from the Installed tab.
 * All installed skills are bookmarkable regardless of source info.
 * @param _skill - Installed skill (unused, kept for call-site compatibility)
 * @returns always true
 * @example
 * canBookmarkSkill({ source: 'pbakaus/impeccable', ... }) // => true
 * canBookmarkSkill({ source: undefined, ... })            // => true
 */
export function canBookmarkSkill(_skill: Skill): boolean {
  return true
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
  repo: RepositoryId | ''
  url: HttpUrl
} {
  const repo = skill.source ?? ''
  const url = skill.sourceUrl
    ? skill.sourceUrl.replace(/\.git$/, '')
    : `https://github.com/${repo}`
  return { repo, url }
}
