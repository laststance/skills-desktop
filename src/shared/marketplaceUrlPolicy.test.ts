import { describe, expect, it } from 'vitest'

import { isAllowedSkillsUrl } from './marketplaceUrlPolicy'

describe('isAllowedSkillsUrl', () => {
  it('opens a skills.sh HTTPS link on the implicit default port', () => {
    // Arrange
    const url = 'https://skills.sh/trending'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(true)
  })

  it('opens a skills.sh HTTPS link on the explicit 443 port', () => {
    // Arrange
    const url = 'https://skills.sh:443/hot'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(true)
  })

  it('blocks a skills.sh link on a non-standard port', () => {
    // Arrange
    const url = 'https://skills.sh:444/trending'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(false)
  })

  it('blocks a plain-HTTP skills.sh link', () => {
    // Arrange
    const url = 'http://skills.sh/trending'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(false)
  })

  it('blocks a look-alike subdomain that only ends in skills.sh', () => {
    // Arrange
    const url = 'https://skills.sh.evil.com/trending'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(false)
  })

  it('blocks a string that is not a parseable URL', () => {
    // Arrange
    const url = 'notaurl'
    // Act
    const allowed = isAllowedSkillsUrl(url)
    // Assert
    expect(allowed).toBe(false)
  })
})
