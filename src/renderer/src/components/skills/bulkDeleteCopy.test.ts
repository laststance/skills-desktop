import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'

import { renderBulkDeleteDescription } from './bulkDeleteCopy'

// The base trash + undo sentence the dialog always opens with (plural batch).
const BASE_PLURAL =
  'This moves the skills to the app trash and removes every symlink pointing to them. You can restore within 15 seconds from the notification.'

describe('renderBulkDeleteDescription', () => {
  it('returns the base trash-and-undo copy when no repo filter is active', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 3,
      sourceSummary: null,
    })

    // Assert — no scope clause is appended
    expect(description).toBe(BASE_PLURAL)
  })

  it('singularizes the base copy for a one-skill batch', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 1,
      sourceSummary: null,
    })

    // Assert — "skill"/"it" instead of "skills"/"them"
    expect(description).toBe(
      'This moves the skill to the app trash and removes every symlink pointing to it. You can restore within 15 seconds from the notification.',
    )
  })

  it('describes orphan-only cleanup without promising trash undo', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      trashCount: 0,
      orphanCleanupCount: 2,
      sourceSummary: null,
    })

    // Assert — orphan cleanup has no tombstone or UndoToast restore path
    expect(description).toBe(
      'This removes reviewed dangling symlinks for 2 orphan skills. Source skill files are already missing, and this cleanup cannot be undone from the notification.',
    )
  })

  it('separates trash undo from orphan cleanup in a mixed delete batch', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 3,
      trashCount: 1,
      orphanCleanupCount: 2,
      sourceSummary: null,
    })

    // Assert — only tombstoned source skills advertise the undo window
    expect(description).toBe(
      'This moves 1 skill to the app trash with a 15-second restore window and removes reviewed dangling symlinks for 2 orphan skills. Orphan cleanup cannot be undone from the notification.',
    )
  })

  it('names the single in-scope repository', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [repositoryId('vercel-labs/skills')],
        localHiddenCount: 0,
      },
    })

    // Assert — the one repo is named verbatim
    expect(description).toBe(
      `${BASE_PLURAL} Only skills from vercel-labs/skills are in scope.`,
    )
  })

  it('spells a long repository in full, not the truncated trigger label', () => {
    // Arrange — a slug past the 28-char trigger-truncation threshold
    const longRepo = repositoryId(
      'very-long-owner-name/extremely-long-repository',
    )

    // Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [longRepo],
        localHiddenCount: 0,
      },
    })

    // Assert — the destructive confirm shows the exact source, no middle ellipsis
    expect(description).toBe(
      `${BASE_PLURAL} Only skills from very-long-owner-name/extremely-long-repository are in scope.`,
    )
  })

  it('summarizes multiple in-scope repositories by count', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [
          repositoryId('vercel-labs/skills'),
          repositoryId('pbakaus/impeccable'),
        ],
        localHiddenCount: 0,
      },
    })

    // Assert — repos collapse to a count rather than a long list
    expect(description).toBe(
      `${BASE_PLURAL} Only skills from the 2 selected repositories are in scope.`,
    )
  })

  it('notes that hidden local skills are not affected (plural)', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [],
        localHiddenCount: 2,
      },
    })

    // Assert — reassures the user the suppressed locals stay untouched
    expect(description).toBe(
      `${BASE_PLURAL} 2 local skills hidden by the source filter are not affected.`,
    )
  })

  it('singularizes the hidden-locals note for a single local skill', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [],
        localHiddenCount: 1,
      },
    })

    // Assert — "1 local skill … is not affected"
    expect(description).toBe(
      `${BASE_PLURAL} 1 local skill hidden by the source filter is not affected.`,
    )
  })

  it('appends both the repo scope and the hidden-locals note', () => {
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [repositoryId('vercel-labs/skills')],
        localHiddenCount: 1,
      },
    })

    // Assert — scope sentence first, then the hidden-locals reassurance
    expect(description).toBe(
      `${BASE_PLURAL} Only skills from vercel-labs/skills are in scope. 1 local skill hidden by the source filter is not affected.`,
    )
  })

  it('falls back to the base copy when the summary carries neither repos nor hidden locals', () => {
    // Defensive branch: a non-null summary with empty scope must not append a
    // dangling space or empty sentence.
    // Arrange / Act
    const description = renderBulkDeleteDescription({
      totalCount: 2,
      sourceSummary: {
        repositoryIds: [],
        localHiddenCount: 0,
      },
    })

    // Assert
    expect(description).toBe(BASE_PLURAL)
  })
})
