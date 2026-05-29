import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'
import type { Skill } from '@/shared/types'

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
    isSource: true,
    isOrphan: false,
    ...overrides,
  }
}

describe('canBookmarkSkill', () => {
  it('allows bookmarking a skill that has a source repo', () => {
    // Arrange
    const skill = makeSkill({ source: repositoryId('pbakaus/impeccable') })

    // Act
    const canBookmark = canBookmarkSkill(skill)

    // Assert
    expect(canBookmark).toBe(true)
  })

  it('allows bookmarking a local skill that has no source repo', () => {
    // Arrange
    const skill = makeSkill({ source: undefined })

    // Act
    const canBookmark = canBookmarkSkill(skill)

    // Assert
    expect(canBookmark).toBe(true)
  })

  it('allows bookmarking a skill whose source is an empty string', () => {
    // Arrange
    const skill = makeSkill({ source: repositoryId('') })

    // Act
    const canBookmark = canBookmarkSkill(skill)

    // Assert
    expect(canBookmark).toBe(true)
  })
})

describe('skillToBookmarkData', () => {
  it('saves a clean repo link by stripping the .git suffix off the source URL', () => {
    // Arrange
    const skill = makeSkill({
      source: repositoryId('pbakaus/impeccable'),
      sourceUrl: 'https://github.com/pbakaus/impeccable.git',
    })

    // Act
    const result = skillToBookmarkData(skill)

    // Assert
    expect(result).toEqual({
      repo: 'pbakaus/impeccable',
      url: 'https://github.com/pbakaus/impeccable',
    })
  })

  it('keeps a source URL that has no .git suffix unchanged when saving the bookmark', () => {
    // Arrange
    const skill = makeSkill({
      source: repositoryId('laststance/skills'),
      sourceUrl: 'https://github.com/laststance/skills',
    })

    // Act
    const result = skillToBookmarkData(skill)

    // Assert
    expect(result).toEqual({
      repo: 'laststance/skills',
      url: 'https://github.com/laststance/skills',
    })
  })

  it('builds a GitHub link from the repo when the skill carries no source URL', () => {
    // Arrange
    const skill = makeSkill({
      source: repositoryId('laststance/skills'),
      sourceUrl: undefined,
    })

    // Act
    const result = skillToBookmarkData(skill)

    // Assert
    expect(result).toEqual({
      repo: 'laststance/skills',
      url: 'https://github.com/laststance/skills',
    })
  })

  it('saves an empty repo when the skill has neither a source nor a source URL', () => {
    // Arrange
    const skill = makeSkill({ source: undefined, sourceUrl: undefined })

    // Act
    const result = skillToBookmarkData(skill)

    // Assert
    expect(result).toEqual({
      repo: '',
      url: 'https://github.com/',
    })
  })
})
