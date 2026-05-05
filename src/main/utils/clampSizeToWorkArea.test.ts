import { describe, expect, it } from 'vitest'

import { clampSizeToWorkArea } from './clampSizeToWorkArea'

describe('clampSizeToWorkArea', () => {
  it('returns the desired size when it fits inside the work area', () => {
    expect(
      clampSizeToWorkArea(
        { width: 1000, height: 700 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1000, height: 700 })
  })

  it('clamps width when it exceeds the work area', () => {
    expect(
      clampSizeToWorkArea(
        { width: 3000, height: 700 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1440, height: 700 })
  })

  it('clamps height when it exceeds the work area', () => {
    expect(
      clampSizeToWorkArea(
        { width: 1000, height: 2000 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1000, height: 900 })
  })

  it('clamps both dimensions independently', () => {
    expect(
      clampSizeToWorkArea(
        { width: 3000, height: 2000 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1440, height: 900 })
  })

  it('preserves an exact-match size', () => {
    expect(
      clampSizeToWorkArea(
        { width: 1440, height: 900 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1440, height: 900 })
  })
})
