import { describe, expect, it } from 'vitest'

import type {
  SyncExecuteResult,
  SyncPreviewResult,
} from '../../../shared/types'

import { shouldShowSyncConfirm, shouldShowSyncResult } from './syncHelpers'

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
