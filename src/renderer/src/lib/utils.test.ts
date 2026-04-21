import { describe, expect, it } from 'vitest'

import { formatInstallCount } from './utils'

describe('formatInstallCount', () => {
  it('returns em dash when count is undefined', () => {
    expect(formatInstallCount(undefined)).toBe('—')
  })

  it('returns raw number string for values below 1K', () => {
    expect(formatInstallCount(0)).toBe('0')
    expect(formatInstallCount(999)).toBe('999')
  })

  it('formats 1K boundary as K notation', () => {
    expect(formatInstallCount(1_000)).toBe('1.0K')
  })

  it('rounds near 1M boundary to M notation', () => {
    expect(formatInstallCount(999_999)).toBe('1.0M')
  })

  it('formats 1M boundary as M notation', () => {
    expect(formatInstallCount(1_000_000)).toBe('1.0M')
  })
})
