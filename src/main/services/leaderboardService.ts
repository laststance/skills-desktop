import { repositoryId } from '../../shared/types'
import type { RankingFilter, SkillSearchResult } from '../../shared/types'
import { REPO_PATTERN, SKILL_NAME_PATTERN } from '../utils/skillIdentifiers'

/** Maps ranking filter to skills.sh URL */
const LEADERBOARD_URLS: Record<RankingFilter, string> = {
  'all-time': 'https://skills.sh/',
  trending: 'https://skills.sh/trending',
  hot: 'https://skills.sh/hot',
}

/**
 * Known CSS class signature to verify the page is a skills.sh leaderboard.
 * If this is missing from the response, the HTML structure likely changed.
 */
const STABILITY_SIGNATURE = '<h3'

/** Maximum number of skills to return per leaderboard page */
const MAX_RESULTS = 50

/**
 * Parse a formatted install count string to a number.
 * @param text - Formatted count string from skills.sh
 * @returns Parsed integer count
 * @example
 * parseFormattedCount('731.2K') // => 731200
 * parseFormattedCount('1.5M')   // => 1500000
 * parseFormattedCount('927')    // => 927
 * parseFormattedCount('12.3K')  // => 12300
 */
export function parseFormattedCount(text: string): number {
  const trimmed = text.trim().replace(/,/g, '')
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i)
  if (!match) return 0

  const num = parseFloat(match[1])
  const suffix = match[2]?.toUpperCase()

  if (suffix === 'K') return Math.round(num * 1_000)
  if (suffix === 'M') return Math.round(num * 1_000_000)
  if (suffix === 'B') return Math.round(num * 1_000_000_000)
  return Math.round(num)
}

/**
 * Parse skills.sh leaderboard HTML into structured results.
 * Uses a common anchor pattern that works across all three pages:
 * each skill row is an `<a href="/owner/repo/skill">` containing
 * an `<h3>skill-name</h3>` and a formatted install count.
 *
 * @param html - Raw HTML string from skills.sh
 * @returns Parsed skill results (max 50)
 * @example
 * parseLeaderboardHtml('<a href="/vercel-labs/skills/find-skills"><h3>find-skills</h3>...')
 * // => [{ rank: 1, name: 'find-skills', repo: 'vercel-labs/skills', url: '...', installCount: 731200 }]
 */
export function parseLeaderboardHtml(html: string): SkillSearchResult[] {
  // Stability check: verify the page contains expected markup
  if (!html.includes(STABILITY_SIGNATURE)) {
    throw new Error(
      'Leaderboard HTML structure mismatch (stability signature missing)',
    )
  }

  const results: SkillSearchResult[] = []
  let rank = 1

  // Match anchor tags linking to skill detail pages: /owner/repo/skill-name
  // The href pattern is consistent across all three leaderboard pages
  const anchorPattern =
    /<a\s[^>]*href="\/([^"\/]+\/[^"\/]+)\/([^"\/]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let anchorMatch: RegExpExecArray | null

  while (
    (anchorMatch = anchorPattern.exec(html)) !== null &&
    results.length < MAX_RESULTS
  ) {
    const repo = anchorMatch[1]
    const skillSlug = anchorMatch[2]
    const innerHtml = anchorMatch[3]

    // Extract skill name from <h3> inside the anchor
    const h3Match = innerHtml.match(/<h3[^>]*>(.*?)<\/h3>/i)
    if (!h3Match) continue

    const name = h3Match[1].trim()

    // Defense-in-depth: skills.sh HTML is upstream-controlled. Without this
    // whitelist, a malformed `<h3>` could land in the installed-badge
    // aria-label/title (`npx skills remove <name> --global`) and become a
    // copy-paste hazard. Mirrors `parseSearchOutput`'s CLI-side guard so both
    // ingestion paths enforce the same identifier contract.
    if (!REPO_PATTERN.test(repo) || !SKILL_NAME_PATTERN.test(name)) continue

    // Extract install count: look for numbers with optional K/M/B suffix.
    // Excludes rank numbers (preceded by #) and delta numbers (preceded by +/-)
    // This appears as standalone text like "731.2K", "20.0K", "927"
    const countCandidates = innerHtml.match(
      /(?<!#)(?<![+-])\b(\d[\d,.]*\s*[KMB]?)\b/gi,
    )
    let installCount = 0
    if (countCandidates) {
      // Prefer the largest parsed number to avoid trailing-metric corruption
      for (const candidate of countCandidates) {
        const parsed = parseFormattedCount(candidate)
        if (parsed > 0) {
          installCount = Math.max(installCount, parsed)
        }
      }
    }

    results.push({
      rank: rank++,
      name,
      repo: repositoryId(repo),
      url: `https://skills.sh/${repo}/${skillSlug}`,
      installCount,
    })
  }

  return results
}

/**
 * Fetch and parse a skills.sh leaderboard page.
 * Runs in the main process (Node.js). Returns structured skill data
 * that crosses the IPC boundary to the renderer.
 *
 * @param filter - Which leaderboard to fetch
 * @returns Parsed skill results
 * @throws Error if fetch fails or returns non-200 status
 * @example
 * fetchLeaderboard('all-time')
 * // => [{ rank: 1, name: 'find-skills', ... }, ...]
 */
export async function fetchLeaderboard(
  filter: RankingFilter,
): Promise<SkillSearchResult[]> {
  const url = LEADERBOARD_URLS[filter]
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'skills-desktop/1.0',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch leaderboard: ${response.status} ${response.statusText}`,
    )
  }

  const html = await response.text()
  return parseLeaderboardHtml(html)
}
