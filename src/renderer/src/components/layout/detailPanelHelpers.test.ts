import { describe, expect, it } from 'vitest'

import { DashboardCanvas } from '@/renderer/src/components/dashboard/DashboardCanvas'
import { resolveDetailPanelContent } from '@/renderer/src/components/layout/detailPanelHelpers'
import { MarketplaceDetailPanel } from '@/renderer/src/components/marketplace/MarketplaceDetailPanel'
import { SkillDetail } from '@/renderer/src/components/skills/SkillDetail'
import type { Skill } from '@/shared/types'

// Minimal selected skill — only its identity is threaded through, never read here.
const SELECTED_SKILL: Skill = {
  name: 'foo',
  description: 'foo skill',
  path: '/u/me/.agents/skills/foo',
  symlinkCount: 0,
  symlinks: [],
  isSource: true,
  isOrphan: false,
}

describe('resolveDetailPanelContent', () => {
  it('shows the Marketplace inspector when the Marketplace tab is active', () => {
    // Arrange / Act — marketplace tab, nothing selected
    const content = resolveDetailPanelContent('marketplace', null)

    // Assert
    expect(content.type).toBe(MarketplaceDetailPanel)
  })

  it('keeps showing the Marketplace inspector even when a skill is selected', () => {
    // Arrange / Act — marketplace tab AND a selected skill: the tab must win first
    const content = resolveDetailPanelContent('marketplace', SELECTED_SKILL)

    // Assert — a lingering selection does not override the marketplace tab
    expect(content.type).toBe(MarketplaceDetailPanel)
  })

  it('shows the selected skill detail on the Installed tab when a skill is selected', () => {
    // Arrange / Act
    const content = resolveDetailPanelContent('installed', SELECTED_SKILL)

    // Assert — routes to SkillDetail and threads the exact selected skill through
    expect(content.type).toBe(SkillDetail)
    expect(content).toMatchObject({ props: { skill: SELECTED_SKILL } })
  })

  it('shows the dashboard canvas on the Installed tab when no skill is selected', () => {
    // Arrange / Act
    const content = resolveDetailPanelContent('installed', null)

    // Assert
    expect(content.type).toBe(DashboardCanvas)
  })
})
