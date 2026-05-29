import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type { SyncExecuteResult, SyncPreviewResult } from '@/shared/types'

import {
  getSyncResultPresentation,
  shouldShowSyncConfirm,
  shouldShowSyncResult,
} from './syncHelpers'

/** Helper to build a SyncExecuteResult with sensible defaults */
function buildResult(
  overrides: Partial<SyncExecuteResult> = {},
): SyncExecuteResult {
  return {
    success: true,
    created: 0,
    replaced: 0,
    skipped: 0,
    errors: [],
    details: [],
    ...overrides,
  }
}

/** Helper to build a SyncPreviewResult with sensible defaults */
function buildPreview(
  overrides: Partial<SyncPreviewResult> = {},
): SyncPreviewResult {
  return {
    totalSkills: 5,
    totalAgents: 10,
    toCreate: 0,
    alreadySynced: 0,
    conflicts: [],
    ...overrides,
  }
}

describe('shouldShowSyncConfirm', () => {
  it('keeps the sync confirm dialog hidden when there is no preview to confirm', () => {
    // Arrange
    const noPreview = null
    // Act
    const shouldShow = shouldShowSyncConfirm(noPreview)
    // Assert
    expect(shouldShow).toBe(false)
  })

  it('opens the sync confirm dialog when there are new symlinks to create and no conflicts', () => {
    // Arrange
    const preview = buildPreview({ toCreate: 8 })
    // Act
    const shouldShow = shouldShowSyncConfirm(preview)
    // Assert
    expect(shouldShow).toBe(true)
  })

  it('keeps the sync confirm dialog hidden when everything is already synced', () => {
    // Arrange
    const preview = buildPreview({ toCreate: 0, alreadySynced: 50 })
    // Act
    const shouldShow = shouldShowSyncConfirm(preview)
    // Assert
    expect(shouldShow).toBe(false)
  })

  it('defers to the conflict dialog instead of the confirm dialog when conflicts exist', () => {
    // Arrange
    const preview = buildPreview({
      toCreate: 3,
      conflicts: [
        {
          skillName: 'test-skill',
          agentId: 'claude' as never,
          agentName: 'Claude' as never,
          agentSkillPath: '/home/user/.claude/skills/test-skill',
        },
      ],
    })
    // Act
    const shouldShow = shouldShowSyncConfirm(preview)
    // Assert
    expect(shouldShow).toBe(false)
  })

  it('keeps the sync confirm dialog hidden when there is nothing to create and no conflicts', () => {
    // Arrange
    const preview = buildPreview({ toCreate: 0, conflicts: [] })
    // Act
    const shouldShow = shouldShowSyncConfirm(preview)
    // Assert
    expect(shouldShow).toBe(false)
  })
})

describe('shouldShowSyncResult', () => {
  it('keeps the sync result dialog hidden when no sync has run yet', () => {
    // Arrange
    const noResult = null
    // Act
    const shouldShow = shouldShowSyncResult(noResult)
    // Assert
    expect(shouldShow).toBe(false)
  })

  it('opens the sync result dialog after a successful sync completes', () => {
    // Arrange
    const result: SyncExecuteResult = {
      success: true,
      created: 3,
      replaced: 0,
      skipped: 2,
      errors: [],
      details: [
        { skillName: 'my-skill', agentName: 'Claude Code', action: 'created' },
      ],
    }
    // Act
    const shouldShow = shouldShowSyncResult(result)
    // Assert
    expect(shouldShow).toBe(true)
  })

  it('still opens the sync result dialog when the sync finished with errors', () => {
    // Arrange
    const result: SyncExecuteResult = {
      success: false,
      created: 0,
      replaced: 0,
      skipped: 0,
      errors: [{ path: '/test', error: 'fail' }],
      details: [
        {
          skillName: 'fail-skill',
          agentName: 'Cursor',
          action: 'error',
          error: 'fail',
        },
      ],
    }
    // Act
    const shouldShow = shouldShowSyncResult(result)
    // Assert
    expect(shouldShow).toBe(true)
  })
})

describe('getSyncResultPresentation', () => {
  it('shows a green success state saying nothing changed when no symlinks were touched', () => {
    // Arrange
    const emptyResult = buildResult()
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(emptyResult)
    // Assert
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('No changes were made')
  })

  it('shows a green success state counting the symlinks created', () => {
    // Arrange
    const createdOnlyResult = buildResult({ created: 3 })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(createdOnlyResult)
    // Assert
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('Created 3 symlinks')
  })

  it('pluralizes "symlink" in the singular when exactly one was created', () => {
    // Arrange
    const oneCreatedResult = buildResult({ created: 1 })
    // Act
    const { description } = getSyncResultPresentation(oneCreatedResult)
    // Assert
    expect(description).toBe('Created 1 symlink')
  })

  it('pluralizes "conflict" in the singular when exactly one was replaced', () => {
    // Arrange
    const oneReplacedResult = buildResult({ replaced: 1 })
    // Act
    const { description } = getSyncResultPresentation(oneReplacedResult)
    // Assert
    expect(description).toBe('Replaced 1 conflict')
  })

  it('combines created, replaced, and failed counts into one comma-separated summary', () => {
    // Arrange
    const mixedResult = buildResult({
      created: 2,
      replaced: 3,
      errors: [{ path: '/a', error: 'x' }],
    })
    // Act
    const { description } = getSyncResultPresentation(mixedResult)
    // Assert
    expect(description).toBe(
      'Created 2 symlinks, Replaced 3 conflicts, 1 failed',
    )
  })

  it('shows a red error state when every change failed', () => {
    // Arrange
    const allFailedResult = buildResult({
      errors: [{ path: '/a', error: 'boom' }],
    })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(allFailedResult)
    // Assert
    expect(HeaderIcon).toBe(XCircle)
    expect(iconColor).toBe('text-destructive')
    expect(description).toBe('1 failed')
  })

  it('shows an amber partial-failure state when some changes succeeded and some failed', () => {
    // Arrange
    const partialFailureResult = buildResult({
      created: 2,
      errors: [{ path: '/a', error: 'boom' }],
    })
    // Act
    const { HeaderIcon, iconColor } =
      getSyncResultPresentation(partialFailureResult)
    // Assert
    expect(HeaderIcon).toBe(AlertTriangle)
    expect(iconColor).toBe('text-amber-500')
  })

  it('counts a replaced conflict as a success so it shows the amber partial state alongside errors', () => {
    // Arrange
    const replacedWithErrorResult = buildResult({
      replaced: 1,
      errors: [{ path: '/a', error: 'boom' }],
    })
    // Act
    const { HeaderIcon, iconColor } = getSyncResultPresentation(
      replacedWithErrorResult,
    )
    // Assert
    expect(HeaderIcon).toBe(AlertTriangle)
    expect(iconColor).toBe('text-amber-500')
  })

  it('shows a green success state saying nothing changed when everything was already up to date', () => {
    // Arrange
    const skippedOnlyResult = buildResult({ skipped: 5 })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(skippedOnlyResult)
    // Assert
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('No changes were made')
  })
})
