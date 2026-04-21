import { SKILLS_SH_HOSTNAME } from './constants'

/**
 * Validate whether a URL is safe for marketplace webview navigation.
 * @param candidateUrl - URL from skill metadata or an in-webview navigation event.
 * @returns
 * - `true`: HTTPS URL on `skills.sh` with default HTTPS port (`443` or omitted).
 * - `false`: Parse failure, non-HTTPS scheme, non-allowlisted hostname, or custom port.
 * @example
 * isAllowedSkillsUrl('https://skills.sh/trending') // => true
 * @example
 * isAllowedSkillsUrl('https://skills.sh:443/trending') // => true
 * @example
 * isAllowedSkillsUrl('https://skills.sh:444/trending') // => false
 */
export function isAllowedSkillsUrl(candidateUrl: string): boolean {
  try {
    const parsed = new URL(candidateUrl)
    const isHttps = parsed.protocol === 'https:'
    const isAllowedHostname = parsed.hostname === SKILLS_SH_HOSTNAME
    const isAllowedPort = parsed.port === '' || parsed.port === '443'
    return isHttps && isAllowedHostname && isAllowedPort
  } catch {
    return false
  }
}
