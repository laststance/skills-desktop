import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { SkillSearchResult } from '@/shared/types'
import { repositoryId } from '@/shared/types'

import { MarketplaceSkillRow } from './MarketplaceSkillRow'

/**
 * Build a `SkillSearchResult` fixture, overriding only the fields a spec
 * asserts so each test stays a self-contained Arrange block. Routing through a
 * factory also gives the prop a call-expression initializer, keeping fixture
 * construction out of the render expression (inline object literals would
 * allocate anew on every render).
 * @param overrides - Partial overrides for the fixture under test.
 * @returns A valid `SkillSearchResult`.
 * @example
 * makeSkill({ installCount: 2480 }) // a trending row with a K-formatted count
 */
function makeSkill(
  overrides: Partial<SkillSearchResult> = {},
): SkillSearchResult {
  return {
    rank: 1,
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/task',
    ...overrides,
  }
}

describe('MarketplaceSkillRow', () => {
  it('opens the skill on skills.sh in a new browser tab when the row is clicked', async () => {
    // Arrange: a fully-populated trending skill row.
    const skill = makeSkill({
      rank: 1,
      name: 'task',
      repo: repositoryId('vercel-labs/skills'),
      url: 'https://skills.sh/task',
      installCount: 2480,
    })

    // Act
    const screen = await render(<MarketplaceSkillRow skill={skill} />)

    // Assert: the whole row is one accessible link that points at the skill's
    // canonical URL and targets a new window, so a regression that dropped the
    // anchor (breaking the "click anywhere opens the browser" contract) fails.
    const link = screen.getByRole('link', {
      name: 'Open task from vercel-labs/skills in browser',
    })
    await expect.element(link).toHaveAttribute('href', 'https://skills.sh/task')
    await expect.element(link).toHaveAttribute('target', '_blank')
    await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')

    // Assert: rank, name, repo, and the K-formatted install count are visible.
    await expect.element(screen.getByText('1', { exact: true })).toBeVisible()
    await expect
      .element(screen.getByText('task', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('vercel-labs/skills', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('2.5K', { exact: true }))
      .toBeVisible()
  })

  it('shows a dash for the install count when the skill has no install data', async () => {
    // Arrange: a CLI-search-style result with no installCount field.
    const skill = makeSkill({
      rank: 7,
      name: 'review',
      repo: repositoryId('anthropics/skills'),
      url: 'https://skills.sh/review',
    })

    // Act
    const screen = await render(<MarketplaceSkillRow skill={skill} />)

    // Assert: the missing count degrades to the em-dash placeholder rather than
    // rendering "undefined" or a zero.
    await expect.element(screen.getByText('—', { exact: true })).toBeVisible()
  })
})
