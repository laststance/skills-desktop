import { SKILLS_DESKTOP_REPOSITORY_URL } from '../../../shared/constants'

/**
 * Build the GitHub release notes URL for a given app version.
 *
 * Tag convention is `v<semver>` (e.g. `v0.13.4`), matching the tags created
 * by `/electron-release` when it runs `gh release create`.
 *
 * @param version - Semver string without the leading `v` (e.g. `"0.13.4"`).
 * @returns Absolute https URL to the GitHub release page for that tag.
 * @example
 * getReleaseNotesUrl('0.13.4')
 * // => 'https://github.com/laststance/skills-desktop/releases/tag/v0.13.4'
 */
export const getReleaseNotesUrl = (version: string): string =>
  `${SKILLS_DESKTOP_REPOSITORY_URL}/releases/tag/v${version}`
