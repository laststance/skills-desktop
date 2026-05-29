import { describe, expect, it } from 'vitest'

import { FEATURE_FLAGS } from './featureFlags'
import type { FeatureFlag } from './featureFlags'

describe('FEATURE_FLAGS', () => {
  it('gates the marketplace UI behind a boolean toggle', () => {
    // Arrange / Act
    const flagType = typeof FEATURE_FLAGS.ENABLE_MARKETPLACE_UI
    // Assert
    expect(flagType).toBe('boolean')
  })

  it('gates the experimental dashboard behind a boolean toggle', () => {
    // Arrange / Act
    const flagType = typeof FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL
    // Assert
    expect(flagType).toBe('boolean')
  })

  it('exposes the marketplace UI toggle key', () => {
    // Arrange / Act
    const hasMarketplaceKey = 'ENABLE_MARKETPLACE_UI' in FEATURE_FLAGS
    // Assert
    expect(hasMarketplaceKey).toBe(true)
  })

  it('exposes the experimental dashboard toggle key', () => {
    // Arrange / Act
    const hasDashboardKey = 'ENABLE_DASHBOARD_EXPERIMENTAL' in FEATURE_FLAGS
    // Assert
    expect(hasDashboardKey).toBe(true)
  })

  it('ships exactly the two known toggles and no stray flags', () => {
    // Arrange / Act
    const keys = Object.keys(FEATURE_FLAGS)
    // Assert
    expect(keys).toEqual([
      'ENABLE_MARKETPLACE_UI',
      'ENABLE_DASHBOARD_EXPERIMENTAL',
    ])
  })
})

describe('FeatureFlag type', () => {
  it('accepts a known flag name as a FeatureFlag value', () => {
    // Arrange
    const flag: FeatureFlag = 'ENABLE_MARKETPLACE_UI'
    // Act / Assert
    expect(flag).toBe('ENABLE_MARKETPLACE_UI')
  })
})
