import type React from 'react'
import { match, P } from 'ts-pattern'

import { DashboardCanvas } from '@/renderer/src/components/dashboard/DashboardCanvas'
import { MarketplaceDetailPanel } from '@/renderer/src/components/marketplace/MarketplaceDetailPanel'
import { SkillDetail } from '@/renderer/src/components/skills/SkillDetail'
import type { ActiveTab } from '@/renderer/src/redux/slices/uiSlice'
import type { Skill } from '@/shared/types'

/**
 * Pick which Inspector panel the DetailPanel renders for the current route state.
 *
 * Extracted out of the JSX so the routing decision is unit-testable without React
 * Testing Library (per the src/renderer .coderabbit.yaml guideline). Marketplace
 * wins first; the two `'installed'` patterns spell out `activeTab` explicitly
 * (rather than leaning on match order) so the three patterns cover the full
 * ActiveTab × (Skill|null) space AND a future ActiveTab variant breaks
 * `.exhaustive()` at compile time instead of silently routing.
 *
 * @param activeTab - The active top-level tab (`'installed' | 'marketplace'`).
 * @param selectedSkill - The currently selected skill, or `null` when none is selected.
 * @returns
 * - `'marketplace'` (any skill) → `<MarketplaceDetailPanel />`
 * - `'installed'` + a selected skill → `<SkillDetail skill={selectedSkill} />`
 * - `'installed'` + no skill → `<DashboardCanvas />`
 * @example
 * resolveDetailPanelContent('marketplace', null) // => <MarketplaceDetailPanel />
 * resolveDetailPanelContent('installed', skill)  // => <SkillDetail skill={skill} />
 */
export function resolveDetailPanelContent(
  activeTab: ActiveTab,
  selectedSkill: Skill | null,
): React.ReactElement {
  return match({ activeTab, selectedSkill })
    .with({ activeTab: 'marketplace' }, () => <MarketplaceDetailPanel />)
    .with(
      { activeTab: 'installed', selectedSkill: P.nonNullable },
      ({ selectedSkill }) => <SkillDetail skill={selectedSkill} />,
    )
    .with({ activeTab: 'installed', selectedSkill: null }, () => (
      <DashboardCanvas />
    ))
    .exhaustive()
}
