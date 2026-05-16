/**
 * Whitelist patterns for skill identifiers parsed from external sources.
 * Both `parseSearchOutput` (skills CLI text) and `parseLeaderboardHtml`
 * (skills.sh HTML) feed names into UI strings — aria-labels, titles,
 * copy-paste hints. A malformed upstream value could carry shell
 * metacharacters, whitespace, or `..` traversal-shaped tokens that
 * surface as broken UI or, worse, get pasted into a terminal verbatim.
 *
 * Repo segments must:
 *  - start with an alphanumeric (rejects `.`, `..`, `.git`, `-x`)
 *  - contain only `[a-zA-Z0-9._-]` thereafter
 *
 * Skill names follow the same rule and additionally allow `:` because the
 * upstream skills CLI returns namespaced skills like `react:components`.
 *
 * Sharing one source means both parsers stay in lockstep — bumping
 * the rule in one place can't silently leave the other parser laxer.
 */
const REPO_SEGMENT = /[a-zA-Z0-9][a-zA-Z0-9._-]*/
const SKILL_SEGMENT = /[a-zA-Z0-9][a-zA-Z0-9._:-]*/
export const SKILL_NAME_PATTERN = new RegExp(`^${SKILL_SEGMENT.source}$`)
export const REPO_PATTERN = new RegExp(
  `^${REPO_SEGMENT.source}\\/${REPO_SEGMENT.source}$`,
)
