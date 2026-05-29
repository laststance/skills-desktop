import { describe, expect, it } from 'vitest'

import { getReleaseNotesUrl } from './getReleaseNotesUrl'

describe('getReleaseNotesUrl', () => {
  it('builds the GitHub releases tag URL with a v-prefix', () => {
    // Arrange — a bare semver with no leading v
    const version = '0.13.4'

    // Act
    const url = getReleaseNotesUrl(version)

    // Assert — the tag segment gains exactly one v prefix
    expect(url).toBe(
      'https://github.com/laststance/skills-desktop/releases/tag/v0.13.4',
    )
  })

  it('strips a leading v from the input so the tag never gets a doubled prefix', () => {
    // Arrange — a version that already carries a leading v
    const version = 'v1.0.0'

    // Act
    const url = getReleaseNotesUrl(version)

    // Assert — the existing v is consumed, not doubled into "vv1.0.0"
    expect(url).toBe(
      'https://github.com/laststance/skills-desktop/releases/tag/v1.0.0',
    )
  })
})
