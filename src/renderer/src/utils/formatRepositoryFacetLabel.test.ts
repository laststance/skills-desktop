import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'

import { formatRepositoryFacetLabel } from './formatRepositoryFacetLabel'

describe('formatRepositoryFacetLabel', () => {
  it('returns the slug unchanged when it fits the compact trigger width', () => {
    // Arrange — a typical owner/repo well under the 28-char threshold (18 chars)
    const source = repositoryId('vercel-labs/skills')

    // Act
    const label = formatRepositoryFacetLabel(source)

    // Assert — short slugs are shown verbatim
    expect(label).toBe('vercel-labs/skills')
  })

  it('returns the slug unchanged at exactly the 28-char threshold', () => {
    // Arrange — a slug whose length is exactly REPOSITORY_FACET_LABEL_MAX_CHARS
    const source = repositoryId('owner-of-repos/the-repo-name')

    // Act
    const label = formatRepositoryFacetLabel(source)

    // Assert — the boundary is inclusive, so no ellipsis at exactly 28
    expect(label).toBe('owner-of-repos/the-repo-name')
  })

  it('middle-ellipsises an over-long slug, keeping owner head and repo tail', () => {
    // Arrange — a 46-char slug past the threshold
    const source = repositoryId(
      'very-long-owner-name/extremely-long-repository',
    )

    // Act
    const label = formatRepositoryFacetLabel(source)

    // Assert — 12-char head + "..." + 13-char tail = 28 chars total
    expect(label).toBe('very-long-ow...ng-repository')
  })
})
