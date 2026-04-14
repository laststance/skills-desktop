import { describe, expect, it } from 'vitest'

import type { SyncPreviewResult } from '../../../shared/types'

import { shouldShowSyncConfirm } from './syncHelpers'

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
