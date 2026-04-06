import { describe, expect, it } from 'vitest'

import { FEATURE_FLAGS } from './featureFlags'
import type { FeatureFlag } from './featureFlags'

describe('FEATURE_FLAGS', () => {
  it('ENABLE_MARKETPLACE_UI is a boolean', () => {
    expect(typeof FEATURE_FLAGS.ENABLE_MARKETPLACE_UI).toBe('boolean')
  })

  it('contains the ENABLE_MARKETPLACE_UI key', () => {
    expect('ENABLE_MARKETPLACE_UI' in FEATURE_FLAGS).toBe(true)
  })

  it('has no unexpected keys', () => {
    const keys = Object.keys(FEATURE_FLAGS)
    expect(keys).toEqual(['ENABLE_MARKETPLACE_UI'])
  })
})

describe('FeatureFlag type', () => {
  it('ENABLE_MARKETPLACE_UI is a valid FeatureFlag value at runtime', () => {
    const flag: FeatureFlag = 'ENABLE_MARKETPLACE_UI'
    expect(flag).toBe('ENABLE_MARKETPLACE_UI')
  })
})
