import { describe, expect, it } from 'vitest'

import type { Skill } from '../../../../shared/types'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'

/**
 * Create a minimal Skill for testing bookmark helpers.
 * @param overrides - Partial Skill fields to customize
 * @returns Skill with sensible defaults
 * @example
 * makeSkill({ source: 'pbakaus/impeccable' })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    path: '/home/user/.agents/skills/test-skill',
    symlinkCount: 0,
    symlinks: [],
    ...overrides,
  }
}

describe('canBookmarkSkill', () => {
  it('returns true when skill has source', () => {
    expect(canBookmarkSkill(makeSkill({ source: 'pbakaus/impeccable' }))).toBe(
      true,
    )
  })

  it('returns true when source is undefined (local skill)', () => {
    expect(canBookmarkSkill(makeSkill({ source: undefined }))).toBe(true)
  })

  it('returns true when source is empty string', () => {
    expect(canBookmarkSkill(makeSkill({ source: '' }))).toBe(true)
  })
})

describe('skillToBookmarkData', () => {
  it('derives url from sourceUrl by stripping .git suffix', () => {
    const result = skillToBookmarkData(
      makeSkill({
        source: 'pbakaus/impeccable',
        sourceUrl: 'https://github.com/pbakaus/impeccable.git',
      }),
    )
    expect(result).toEqual({
      repo: 'pbakaus/impeccable',
      url: 'https://github.com/pbakaus/impeccable',
    })
  })

  it('uses sourceUrl as-is when no .git suffix', () => {
    const result = skillToBookmarkData(
      makeSkill({
        source: 'laststance/skills',
        sourceUrl: 'https://github.com/laststance/skills',
      }),
    )
    expect(result).toEqual({
      repo: 'laststance/skills',
      url: 'https://github.com/laststance/skills',
    })
  })

  it('falls back to GitHub URL when sourceUrl is undefined', () => {
    const result = skillToBookmarkData(
      makeSkill({
        source: 'laststance/skills',
        sourceUrl: undefined,
      }),
    )
    expect(result).toEqual({
      repo: 'laststance/skills',
      url: 'https://github.com/laststance/skills',
    })
  })

  it('uses empty string for repo when source is undefined', () => {
    const result = skillToBookmarkData(
      makeSkill({ source: undefined, sourceUrl: undefined }),
    )
    expect(result).toEqual({
      repo: '',
      url: 'https://github.com/',
    })
  })
})
