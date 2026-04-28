import { SKILLS_DESKTOP_REPOSITORY_URL } from '../../../shared/constants'

/**
 * Build the GitHub release notes URL for a given app version.
 *
 * Tag convention is `v<semver>` (e.g. `v0.13.4`), matching the tags created
 * by `/electron-release` when it runs `gh release create`. A leading `v` (or
 * `V`) on the input is stripped so callers can pass either form without
 * doubling the prefix.
 *
 * @param version - Semver string with or without a leading `v` (e.g. `"0.13.4"` or `"v0.13.4"`).
 * @returns Absolute https URL to the GitHub release page for that tag.
 * @example
 * getReleaseNotesUrl('0.13.4')
 * // => 'https://github.com/laststance/skills-desktop/releases/tag/v0.13.4'
 * getReleaseNotesUrl('v1.0.0')
 * // => 'https://github.com/laststance/skills-desktop/releases/tag/v1.0.0'
 */
export const getReleaseNotesUrl = (version: string): string =>
  `${SKILLS_DESKTOP_REPOSITORY_URL}/releases/tag/v${version.replace(/^v/i, '')}`
