import React from 'react'

import { useAppSelector } from '../../redux/hooks'

import { MarketplaceDashboard } from './MarketplaceDashboard'
import { MarketplaceSkillPreview } from './MarketplaceSkillPreview'

/**
 * Router for the right pane during Marketplace view.
 * previewSkill === null → Dashboard (stats overview)
 * previewSkill !== null → Webview preview of the selected skill
 */
export const MarketplaceDetailPanel = React.memo(
  function MarketplaceDetailPanel(): React.ReactElement {
    const previewSkill = useAppSelector(
      (state) => state.marketplace.previewSkill,
    )

    if (previewSkill) {
      return <MarketplaceSkillPreview skill={previewSkill} />
    }

    return <MarketplaceDashboard />
  },
)
