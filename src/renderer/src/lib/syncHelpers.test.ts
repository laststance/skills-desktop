import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type {
  SyncExecuteResult,
  SyncPreviewResult,
} from '../../../shared/types'

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
  it('returns false when preview is null', () => {
    expect(shouldShowSyncConfirm(null)).toBe(false)
  })

  it('returns true when toCreate > 0 and no conflicts', () => {
    const preview = buildPreview({ toCreate: 8 })
    expect(shouldShowSyncConfirm(preview)).toBe(true)
  })

  it('returns false when toCreate is 0 (already synced)', () => {
    const preview = buildPreview({ toCreate: 0, alreadySynced: 50 })
    expect(shouldShowSyncConfirm(preview)).toBe(false)
  })

  it('returns false when conflicts exist (conflict dialog handles this)', () => {
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
    expect(shouldShowSyncConfirm(preview)).toBe(false)
  })

  it('returns false when both toCreate is 0 and no conflicts', () => {
    const preview = buildPreview({ toCreate: 0, conflicts: [] })
    expect(shouldShowSyncConfirm(preview)).toBe(false)
  })
})

describe('shouldShowSyncResult', () => {
  it('returns false when result is null', () => {
    expect(shouldShowSyncResult(null)).toBe(false)
  })

  it('returns true when a valid result is provided', () => {
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
    expect(shouldShowSyncResult(result)).toBe(true)
  })

  it('returns true even when result has errors', () => {
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
    expect(shouldShowSyncResult(result)).toBe(true)
  })
})

describe('getSyncResultPresentation', () => {
  it('returns success icon and "No changes were made" when result is empty', () => {
    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(buildResult())
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('No changes were made')
  })

  it('returns success icon when only created > 0', () => {
    const { HeaderIcon, iconColor, description } = getSyncResultPresentation(
      buildResult({ created: 3 }),
    )
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('Created 3 symlinks')
  })

  it('uses singular "symlink" when created is 1', () => {
    const { description } = getSyncResultPresentation(
      buildResult({ created: 1 }),
    )
    expect(description).toBe('Created 1 symlink')
  })

  it('uses singular "conflict" when replaced is 1', () => {
    const { description } = getSyncResultPresentation(
      buildResult({ replaced: 1 }),
    )
    expect(description).toBe('Replaced 1 conflict')
  })

  it('joins multiple non-zero parts with comma', () => {
    const { description } = getSyncResultPresentation(
      buildResult({
        created: 2,
        replaced: 3,
        errors: [{ path: '/a', error: 'x' }],
      }),
    )
    expect(description).toBe(
      'Created 2 symlinks, Replaced 3 conflicts, 1 failed',
    )
  })

  it('returns XCircle + destructive when there are only errors', () => {
    const { HeaderIcon, iconColor, description } = getSyncResultPresentation(
      buildResult({ errors: [{ path: '/a', error: 'boom' }] }),
    )
    expect(HeaderIcon).toBe(XCircle)
    expect(iconColor).toBe('text-destructive')
    expect(description).toBe('1 failed')
  })

  it('returns AlertTriangle + amber when errors and successes coexist (partial)', () => {
    const { HeaderIcon, iconColor } = getSyncResultPresentation(
      buildResult({ created: 2, errors: [{ path: '/a', error: 'boom' }] }),
    )
    expect(HeaderIcon).toBe(AlertTriangle)
    expect(iconColor).toBe('text-amber-500')
  })

  it('treats replaced > 0 as success for partial detection', () => {
    const { HeaderIcon, iconColor } = getSyncResultPresentation(
      buildResult({ replaced: 1, errors: [{ path: '/a', error: 'boom' }] }),
    )
    expect(HeaderIcon).toBe(AlertTriangle)
    expect(iconColor).toBe('text-amber-500')
  })

  it('skipped-only is treated as success (all clean, nothing to do)', () => {
    const { HeaderIcon, iconColor, description } = getSyncResultPresentation(
      buildResult({ skipped: 5 }),
    )
    expect(HeaderIcon).toBe(CheckCircle2)
    expect(iconColor).toBe('text-emerald-500')
    expect(description).toBe('No changes were made')
  })
})
