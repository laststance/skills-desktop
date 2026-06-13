import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'

import { COLOR_PRESET_CHROMA, THEME_PRESETS } from '@/shared/constants'
import type { ThemePresetName } from '@/shared/constants'

const GLOBALS_CSS_PATH = resolve(
  process.cwd(),
  'src/renderer/src/styles/globals.css',
)

/**
 * WCAG contrast regression for the unified OKLCH palette in
 * `src/renderer/src/styles/globals.css`. For every preset × mode, every
 * token pair that carries meaning (body text on background, card text on
 * card, primary button label on primary, muted info on muted) must clear
 * WCAG 2.1 thresholds:
 *   - AA normal text = 4.5:1
 *   - AA UI / large  = 3.0:1
 *
 * This test does not re-derive the palette. It pins the minimum contrast
 * so a future tweak of `--chroma-N` multipliers or a shift in a token's
 * `L` value cannot silently render a preset × mode combo unreadable.
 * Prior review caught that the commit claimed "28 combinations verified"
 * while only 5 were hand-audited; this closes that gap by iterating every
 * key in `THEME_PRESETS` × its applicable mode(s) × 4 pairs (color presets
 * flip both modes; neutral / tinted-neutral presets bake one mode in).
 *
 * Tinted-neutral presets (0 < chroma < COLOR_PRESET_CHROMA) additionally
 * carry the `.tone-tinted` gray-base shift from globals.css, so their
 * surface tokens (background / card / muted) are evaluated at the shifted
 * `L` values in TINTED_*_TOKENS below, not the crisp base ramp.
 */

// Mirror of `--chroma-1..7` multipliers in globals.css. If these values
// drift, the test asserts against the wrong palette — update both sides.
const CHROMA_STEP = {
  c1: 0.028,
  c2: 0.044,
  c3: 0.056,
  c4: 0.083,
  c5: 0.111,
  c6: 0.139,
  c7: 0.167,
  full: 1,
} as const

interface TokenSpec {
  readonly L: number
  readonly step: keyof typeof CHROMA_STEP
}

// Token L + chroma-step per mode. Straight copy from globals.css; keeping
// this co-located with the test makes drift obvious in a diff.
const DARK_TOKENS: Record<string, TokenSpec> = {
  background: { L: 0.12, step: 'c5' },
  foreground: { L: 0.98, step: 'c3' },
  card: { L: 0.18, step: 'c6' },
  cardForeground: { L: 0.98, step: 'c3' },
  primary: { L: 0.7, step: 'full' },
  primaryForeground: { L: 0.12, step: 'c5' },
  muted: { L: 0.25, step: 'c7' },
  mutedForeground: { L: 0.65, step: 'c5' },
}

const LIGHT_TOKENS: Record<string, TokenSpec> = {
  background: { L: 0.99, step: 'c1' },
  foreground: { L: 0.15, step: 'c7' },
  card: { L: 0.97, step: 'c2' },
  cardForeground: { L: 0.15, step: 'c7' },
  primary: { L: 0.5, step: 'full' },
  primaryForeground: { L: 0.99, step: 'c1' },
  muted: { L: 0.95, step: 'c4' },
  mutedForeground: { L: 0.45, step: 'c5' },
}

// Tinted-neutral presets apply the `.tone-tinted` gray base from globals.css:
// a uniform per-mode surface shift (+0.05 dark / −0.05 light). Only the
// surface tokens that participate in a contrast pair move (background, card,
// muted); foregrounds and primary stay fixed so text contrast is preserved.
// These mirror `.dark.tone-tinted` / `.light.tone-tinted` in globals.css.
const DARK_TINTED_TOKENS: Record<string, TokenSpec> = {
  ...DARK_TOKENS,
  background: { L: 0.17, step: 'c5' },
  card: { L: 0.23, step: 'c6' },
  muted: { L: 0.3, step: 'c7' },
}

const LIGHT_TINTED_TOKENS: Record<string, TokenSpec> = {
  ...LIGHT_TOKENS,
  background: { L: 0.94, step: 'c1' },
  card: { L: 0.92, step: 'c2' },
  muted: { L: 0.9, step: 'c4' },
}

// Surface tokens whose L was extracted to a `--<token>-l` CSS variable so the
// .tone-tinted gray base can override only the L. The drift guard checks
// these differently from literal-L tokens (foreground, primary, …).
const SURFACE_L_TOKENS = new Set(['background', 'card', 'muted'])

/**
 * A preset is tinted-neutral when its chroma sits strictly between
 * pure-neutral (0) and full color (COLOR_PRESET_CHROMA) — exactly the
 * presets that receive the `.tone-tinted` shifted gray base.
 * @example isTintedNeutral(0.05) // => true  (zinc/clay/…)
 * @example isTintedNeutral(0)    // => false (pure neutral)
 * @example isTintedNeutral(0.16) // => false (full color)
 */
function isTintedNeutral(chroma: number): boolean {
  return chroma > 0 && chroma < COLOR_PRESET_CHROMA
}

/** Build a culori OKLCH color record from a token spec + preset axes. */
function tokenColor(
  token: TokenSpec,
  themeChroma: number,
  hue: number,
): { mode: 'oklch'; l: number; c: number; h: number } {
  return {
    mode: 'oklch',
    l: token.L,
    c: themeChroma * CHROMA_STEP[token.step],
    h: hue,
  }
}

function contrast(
  fg: TokenSpec,
  bg: TokenSpec,
  themeChroma: number,
  hue: number,
): number {
  return wcagContrast(
    tokenColor(fg, themeChroma, hue),
    tokenColor(bg, themeChroma, hue),
  )
}

describe('WCAG contrast — unified OKLCH palette', () => {
  const presetNames = Object.keys(THEME_PRESETS) as ThemePresetName[]

  for (const name of presetNames) {
    const config = THEME_PRESETS[name]
    // Neutral presets bake in a mode; color presets flip both ways.
    const modes: Array<'dark' | 'light'> =
      'mode' in config ? [config.mode] : ['dark', 'light']

    // Tinted-neutral presets carry the `.tone-tinted` shifted gray base.
    const tinted = isTintedNeutral(config.chroma)

    describe(`preset "${name}" (hue ${config.hue}, chroma ${config.chroma})`, () => {
      for (const mode of modes) {
        const tokens =
          mode === 'dark'
            ? tinted
              ? DARK_TINTED_TOKENS
              : DARK_TOKENS
            : tinted
              ? LIGHT_TINTED_TOKENS
              : LIGHT_TOKENS

        it(`${mode}: keeps body text readable on the background (AA 4.5:1)`, () => {
          // Arrange — foreground vs background tokens for this preset × mode
          // Act
          const ratio = contrast(
            tokens.foreground,
            tokens.background,
            config.chroma,
            config.hue,
          )
          // Assert — body copy clears the WCAG AA normal-text floor
          expect(ratio).toBeGreaterThanOrEqual(4.5)
        })

        it(`${mode}: keeps card text readable on its card surface (AA 4.5:1)`, () => {
          // Arrange — card-foreground vs card tokens for this preset × mode
          // Act
          const ratio = contrast(
            tokens.cardForeground,
            tokens.card,
            config.chroma,
            config.hue,
          )
          // Assert — card body copy clears the WCAG AA normal-text floor
          expect(ratio).toBeGreaterThanOrEqual(4.5)
        })

        // `primary` surfaces `<Button variant="default">` (used in the
        // ThemeSelector trigger and the sidebar action bar) — a UI
        // component with a 14px bold label. WCAG 2.1 classifies 14px bold
        // as "large text" and permits the 3.0:1 minimum for both the UI
        // background and its label. If `primary` is ever adopted for
        // small (<14px regular) body copy, bump this to 4.5.
        it(`${mode}: keeps the primary button label legible on its fill (UI/large-text 3.0:1)`, () => {
          // Arrange — primary-foreground label vs primary fill for this preset × mode
          // Act
          const ratio = contrast(
            tokens.primaryForeground,
            tokens.primary,
            config.chroma,
            config.hue,
          )
          // Assert — the 14px-bold button label clears the WCAG UI/large-text floor
          expect(ratio).toBeGreaterThanOrEqual(3.0)
        })

        // `muted-foreground` on `muted` drives secondary info (path hints
        // in `FileContent`, timestamps in the sidebar, nav section
        // headers). These surfaces are non-critical supporting text; the
        // WCAG 2.1 UI/large-text threshold of 3.0:1 applies. The moment
        // muted carries primary body copy (e.g., a paragraph in an
        // empty-state screen), this assertion must be raised to 4.5.
        it(`${mode}: keeps muted secondary text legible on its muted surface (UI/secondary 3.0:1)`, () => {
          // Arrange — muted-foreground vs muted tokens for this preset × mode
          // Act
          const ratio = contrast(
            tokens.mutedForeground,
            tokens.muted,
            config.chroma,
            config.hue,
          )
          // Assert — secondary supporting text clears the WCAG UI/secondary floor
          expect(ratio).toBeGreaterThanOrEqual(3.0)
        })
      }
    })
  }
})

/**
 * Drift guard: the L/step tables above are hand-mirrored from globals.css.
 * If someone retunes `--background-l: 0.12` (or the token's `oklch(...)`
 * formula) without updating `DARK_TOKENS.background.L`, the contrast
 * assertions would evaluate a fictional palette and pass while real
 * rendering regresses. This reads globals.css as text and verifies each
 * pair the test makes claims about actually appears in the CSS.
 *
 * Surface tokens (background / card / muted) had their `L` extracted to a
 * `--<token>-l` variable so `.tone-tinted` can override just the L. For
 * those we verify two fragments: the `--<token>-l: <L>` declaration and the
 * token's `oklch(var(--<token>-l) ...)` reference. Literal-L tokens
 * (foreground, primary, …) are still matched as one `oklch(<L> ...)` chunk.
 */
describe('WCAG contrast — globals.css drift guard', () => {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')
  // `\.dark\s*\{` only matches the base `.dark {` block — `.dark.tone-tinted {`
  // has a `.` (not whitespace/`{`) after `.dark`, so it is excluded here.
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const lightBlock = css.match(/\.light\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const darkTintedBlock =
    css.match(/\.dark\.tone-tinted\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const lightTintedBlock =
    css.match(/\.light\.tone-tinted\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

  /** The chroma part of an oklch token: `var(--theme-chroma)` or `var(--chroma-N)`. */
  function chromaVarFragment(step: TokenSpec['step']): string {
    return step === 'full'
      ? 'var(--theme-chroma)'
      : `var(--${step.replace('c', 'chroma-')})`
  }

  /** Assert one token's L/step is mirrored in the given base-mode CSS block. */
  function expectTokenInBlock(
    block: string,
    token: string,
    spec: TokenSpec,
  ): void {
    if (SURFACE_L_TOKENS.has(token)) {
      // Surface token: L lives in a `--<token>-l` var, referenced by the token.
      expect(block).toContain(`--${token}-l: ${spec.L}`)
      expect(block).toContain(
        `oklch(var(--${token}-l) ${chromaVarFragment(spec.step)}`,
      )
    } else {
      expect(block).toContain(`oklch(${spec.L} ${chromaVarFragment(spec.step)}`)
    }
  }

  for (const [token, spec] of Object.entries(DARK_TOKENS)) {
    it(`flags drift if the .dark ${token} L/chroma stops matching globals.css`, () => {
      // Assert — the mirrored L/step still appears verbatim in globals.css
      expectTokenInBlock(darkBlock, token, spec)
    })
  }

  for (const [token, spec] of Object.entries(LIGHT_TOKENS)) {
    it(`flags drift if the .light ${token} L/chroma stops matching globals.css`, () => {
      // Assert — the mirrored L/step still appears verbatim in globals.css
      expectTokenInBlock(lightBlock, token, spec)
    })
  }

  // The `.tone-tinted` blocks override only the surface `--<token>-l` vars
  // that the contrast test re-evaluates for tinted presets. Verify the
  // shifted L values stay in lockstep with DARK_TINTED_TOKENS / LIGHT_TINTED_TOKENS.
  for (const token of SURFACE_L_TOKENS) {
    it(`flags drift if the .dark.tone-tinted ${token} L stops matching globals.css`, () => {
      // Assert — shifted dark surface L still declared as a --<token>-l var
      expect(darkTintedBlock).toContain(
        `--${token}-l: ${DARK_TINTED_TOKENS[token].L}`,
      )
    })

    it(`flags drift if the .light.tone-tinted ${token} L stops matching globals.css`, () => {
      // Assert — shifted light surface L still declared as a --<token>-l var
      expect(lightTintedBlock).toContain(
        `--${token}-l: ${LIGHT_TINTED_TOKENS[token].L}`,
      )
    })
  }
})
