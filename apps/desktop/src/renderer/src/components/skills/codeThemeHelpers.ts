import {
  CODE_THEME_DEFINITIONS,
  DEFAULT_CODE_THEME_ID,
} from '@/shared/constants'

/**
 * A Shiki light/dark theme pair, shaped exactly as `codeToHtml`'s `themes`
 * option expects (keys stay `light` / `dark` — the CSS-var bridge in
 * `globals.css` reads `--shiki-light` / `--shiki-dark` derived from them).
 */
export interface ResolvedCodeTheme {
  light: string
  dark: string
}

/**
 * The default pair, resolved once. A module-scope guard mirrors the
 * `AGENT_IDS` pattern: `DEFAULT_CODE_THEME_ID` is a member of
 * `CODE_THEME_DEFINITIONS` by construction, so the throw is unreachable at
 * runtime and only a future refactor that drops the default would trip it.
 */
const foundDefaultCodeThemeDefinition = CODE_THEME_DEFINITIONS.find(
  (theme) => theme.id === DEFAULT_CODE_THEME_ID,
)
/* v8 ignore next 3 -- defensive: DEFAULT_CODE_THEME_ID is always a CODE_THEME_DEFINITIONS member by construction ('github' is the first entry and the default), so .find() never returns undefined; only a refactor could empty it */
if (!foundDefaultCodeThemeDefinition) {
  throw new Error('DEFAULT_CODE_THEME_ID must exist in CODE_THEME_DEFINITIONS')
}
// Bind the post-throw narrowed value so the type carries into `resolveCodeTheme`
// (a function body does not inherit module-scope control-flow narrowing).
const DEFAULT_CODE_THEME_DEFINITION = foundDefaultCodeThemeDefinition

/**
 * Map a persisted `codeThemeId` to its Shiki `{ light, dark }` pair, falling
 * back to the default for an unknown id. Accepts a bare `string` (not the
 * `CodeThemeId` union) on purpose: it is a forgiving resolver for a value read
 * from `settings.json`, so a stale id left over from a removed theme degrades
 * to the default instead of breaking the preview.
 * @param codeThemeId - Persisted theme id from settings (possibly stale).
 * @returns
 * - The matching pair when `codeThemeId` is a known theme
 * - The default (GitHub) pair when it is unknown
 * @example
 * resolveCodeTheme('vitesse') // => { light: 'vitesse-light', dark: 'vitesse-dark' }
 * resolveCodeTheme('removed') // => { light: 'github-light', dark: 'github-dark' }
 */
export function resolveCodeTheme(codeThemeId: string): ResolvedCodeTheme {
  const definition =
    CODE_THEME_DEFINITIONS.find((theme) => theme.id === codeThemeId) ??
    DEFAULT_CODE_THEME_DEFINITION
  return { light: definition.light, dark: definition.dark }
}
