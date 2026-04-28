import { describe, expect, it } from 'vitest'

import { getReleaseNotesUrl } from './getReleaseNotesUrl'

describe('getReleaseNotesUrl', () => {
  it('builds the GitHub releases tag URL with a v-prefix', () => {
    expect(getReleaseNotesUrl('0.13.4')).toBe(
      'https://github.com/laststance/skills-desktop/releases/tag/v0.13.4',
    )
  })

  it('strips a leading v from the input so the tag never gets a doubled prefix', () => {
    expect(getReleaseNotesUrl('v1.0.0')).toBe(
      'https://github.com/laststance/skills-desktop/releases/tag/v1.0.0',
    )
  })
})
