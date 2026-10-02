import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { describe, expect, test } from 'vitest'

import type { SyncExecuteResult } from '@/shared/types'
import { toAbsolutePath, toSkillName, toSymlinkCount } from '@/shared/types'

import { getSyncResultPresentation, shouldShowSyncResult } from './syncHelpers'

/** Helper to build a SyncExecuteResult with sensible defaults */
function buildResult(
  overrides: Partial<SyncExecuteResult> = {},
): SyncExecuteResult {
  return {
    success: true,
    created: toSymlinkCount(0),
    skipped: toSymlinkCount(0),
    errors: [],
    details: [],
    ...overrides,
  }
}

describe('shouldShowSyncResult', () => {
  test('keeps the sync result dialog hidden when no sync has run yet', () => {
    // Arrange
    const noResult = null
    // Act
    const shouldShow = shouldShowSyncResult(noResult)
    // Assert
    expect(shouldShow).toBe(false)
  })

  test('opens the sync result dialog after a successful sync completes', () => {
    // Arrange
    const result: SyncExecuteResult = {
      success: true,
      created: toSymlinkCount(3),
      skipped: toSymlinkCount(2),
      errors: [],
      details: [
        {
          skillName: toSkillName('my-skill'),
          agentName: 'Claude Code',
          action: 'created',
        },
      ],
    }
    // Act
    const shouldShow = shouldShowSyncResult(result)
    // Assert
    expect(shouldShow).toBe(true)
  })

  test('still opens the sync result dialog when the sync finished with errors', () => {
    // Arrange
    const result: SyncExecuteResult = {
      success: false,
      created: toSymlinkCount(0),
      skipped: toSymlinkCount(0),
      errors: [{ path: toAbsolutePath('/test'), error: 'fail' }],
      details: [
        {
          skillName: toSkillName('fail-skill'),
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
  test('shows a green success state saying nothing changed when no symlinks were touched', () => {
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

  test('shows a green success state counting the symlinks created', () => {
    // Arrange
    const createdOnlyResult = buildResult({ created: toSymlinkCount(3) })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(createdOnlyResult)
    // Assert
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('Created 3 symlinks')
  })

  test('pluralizes "symlink" in the singular when exactly one was created', () => {
    // Arrange
    const oneCreatedResult = buildResult({ created: toSymlinkCount(1) })
    // Act
    const { description } = getSyncResultPresentation(oneCreatedResult)
    // Assert
    expect(description).toBe('Created 1 symlink')
  })

  test('combines created and failed counts into one comma-separated summary', () => {
    // Arrange
    const mixedResult = buildResult({
      created: toSymlinkCount(2),

      errors: [{ path: toAbsolutePath('/a'), error: 'x' }],
    })
    // Act
    const { description } = getSyncResultPresentation(mixedResult)
    // Assert
    expect(description).toBe('Created 2 symlinks, 1 failed')
  })

  test('shows a red error state when every change failed', () => {
    // Arrange
    const allFailedResult = buildResult({
      errors: [{ path: toAbsolutePath('/a'), error: 'boom' }],
    })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(allFailedResult)
    // Assert
    expect(HeaderIcon).toBe(XCircle)
    expect(iconColor).toBe('text-destructive')
    expect(description).toBe('1 failed')
  })

  test('shows an amber partial-failure state when some changes succeeded and some failed', () => {
    // Arrange
    const partialFailureResult = buildResult({
      created: toSymlinkCount(2),
      errors: [{ path: toAbsolutePath('/a'), error: 'boom' }],
    })
    // Act
    const { HeaderIcon, iconColor } =
      getSyncResultPresentation(partialFailureResult)
    // Assert
    expect(HeaderIcon).toBe(AlertTriangle)
    expect(iconColor).toBe('text-amber-500')
  })

  test('shows a green success state saying nothing changed when everything was already up to date', () => {
    // Arrange
    const skippedOnlyResult = buildResult({ skipped: toSymlinkCount(5) })
    // Act
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(skippedOnlyResult)
    // Assert
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('No changes were made')
  })
})
