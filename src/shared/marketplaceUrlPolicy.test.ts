import { describe, expect, it } from 'vitest'

import { isAllowedSkillsUrl } from './marketplaceUrlPolicy'

describe('isAllowedSkillsUrl', () => {
  it('allows https://skills.sh URLs with default HTTPS port', () => {
    expect(isAllowedSkillsUrl('https://skills.sh/trending')).toBe(true)
    expect(isAllowedSkillsUrl('https://skills.sh:443/hot')).toBe(true)
  })

  it('rejects non-allowlisted URLs', () => {
    expect(isAllowedSkillsUrl('https://skills.sh:444/trending')).toBe(false)
    expect(isAllowedSkillsUrl('http://skills.sh/trending')).toBe(false)
    expect(isAllowedSkillsUrl('https://skills.sh.evil.com/trending')).toBe(
      false,
    )
    expect(isAllowedSkillsUrl('notaurl')).toBe(false)
  })
})
