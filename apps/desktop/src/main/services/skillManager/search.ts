import { REPO_PATTERN, SKILL_NAME_PATTERN } from '@/main/utils/skillIdentifiers'
import type { SkillSearchResult } from '@/shared/types'
import {
  repositoryId,
  toHttpUrl,
  toInstallCount,
  toSkillName,
  toSkillRank,
} from '@/shared/types'

import { sanitizeMetadata } from './discover'

/**
 * Marketplace search for the skill manager — a direct port of the skills
 * CLI's `searchSkillsAPI` (v1.7.4) against the same skills.sh endpoint the
 * CLI itself queries. One behavioral upgrade over the CLI: network and HTTP
 * failures THROW instead of silently returning an empty list, because the
 * app has a real error state to render — "search failed" must not look like
 * "no skills exist for this query".
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/**
 * Search endpoint origin. The CLI honors `SKILLS_API_URL` as an override and
 * the manager keeps that verbatim — it is the integration-test seam as well
 * as the CLI-compatible escape hatch.
 */
function searchApiBase(): string {
  return process.env.SKILLS_API_URL ?? 'https://skills.sh'
}

/** Result cap the CLI pins as a literal string in its own query. */
const SEARCH_RESULT_LIMIT = '20'
/** Per-request timeout — the spec's 10 s ceiling for search. */
const SEARCH_TIMEOUT_MS = 10_000

/** Raw shape of one entry in the skills.sh search response. */
interface SearchApiSkill {
  name?: unknown
  id?: unknown
  source?: unknown
  installs?: unknown
}

/**
 * Query the skills.sh search API and map the response onto the app's
 * marketplace result shape. Ordering follows the CLI: install count,
 * descending. Entries whose name or repo would be unsafe downstream (aria
 * labels, copy-paste hints) are dropped, same as the old CLI output parser.
 * @param query - Free-text search exactly as typed in the marketplace.
 * @returns Ranked results, best first.
 * @throws Error when the endpoint cannot be reached or answers with a
 *   non-OK status — the marketplace renders this as its search error state.
 * @example await searchSkills('react')
 */
export async function searchSkills(
  query: string,
): Promise<SkillSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: SEARCH_RESULT_LIMIT })
  const url = `${searchApiBase()}/api/search?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new Error(
      timedOut
        ? 'The skill search timed out. Check your network connection and try again.'
        : 'The skill search could not reach skills.sh. Check your network connection.',
    )
  }
  if (!response.ok) {
    throw new Error(
      `The skill search failed (HTTP ${response.status}). Try again later.`,
    )
  }

  let skills: SearchApiSkill[]
  try {
    const body = (await response.json()) as { skills?: SearchApiSkill[] }
    skills = Array.isArray(body.skills) ? body.skills : []
  } catch {
    throw new Error('The skill search returned an unreadable response.')
  }

  // CLI mapping: name/slug/source pass through sanitizeMetadata, then the
  // list is sorted by installs descending. `source` falls back to the slug —
  // the CLI prints `source || slug` as the installable owner/repo token.
  const mapped = skills
    .map((skill) => ({
      name: typeof skill.name === 'string' ? sanitizeMetadata(skill.name) : '',
      slug: typeof skill.id === 'string' ? sanitizeMetadata(skill.id) : '',
      source:
        typeof skill.source === 'string' ? sanitizeMetadata(skill.source) : '',
      installs: typeof skill.installs === 'number' ? skill.installs : 0,
    }))
    .sort((a, b) => b.installs - a.installs)

  const results: SkillSearchResult[] = []
  let rank = 1
  for (const skill of mapped) {
    const repo = skill.source || skill.slug
    // Same rejection rule the old CLI-output parser enforced: anything that
    // is not a plain owner/repo plus a bare skill name never reaches the UI.
    // The slug joins a URL path verbatim, so it gets the same treatment.
    if (
      !REPO_PATTERN.test(repo) ||
      !SKILL_NAME_PATTERN.test(skill.name) ||
      !/^[a-zA-Z0-9._/-]+$/.test(skill.slug)
    ) {
      continue
    }
    const result: SkillSearchResult = {
      rank: toSkillRank(rank++),
      name: toSkillName(skill.name),
      repo: repositoryId(repo),
      url: toHttpUrl(`https://skills.sh/${skill.slug}`),
    }
    if (skill.installs > 0) {
      result.installCount = toInstallCount(skill.installs)
    }
    results.push(result)
  }
  return results
}
