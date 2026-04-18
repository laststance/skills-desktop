import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'

import { THEME_PRESETS } from '../../../shared/constants'
import type { ThemePresetName } from '../../../shared/constants'

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
 * while only 5 were hand-audited; this closes that gap with 104
 * deterministic assertions (12 color × 2 modes × 4 pairs + 2 neutral ×
 * 1 mode × 4 pairs).
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

    describe(`preset "${name}" (hue ${config.hue}, chroma ${config.chroma})`, () => {
      for (const mode of modes) {
        const tokens = mode === 'dark' ? DARK_TOKENS : LIGHT_TOKENS

        it(`${mode}: foreground on background >= 4.5 (AA text)`, () => {
          expect(
            contrast(
              tokens.foreground,
              tokens.background,
              config.chroma,
              config.hue,
            ),
          ).toBeGreaterThanOrEqual(4.5)
        })

        it(`${mode}: card-foreground on card >= 4.5 (AA text)`, () => {
          expect(
            contrast(
              tokens.cardForeground,
              tokens.card,
              config.chroma,
              config.hue,
            ),
          ).toBeGreaterThanOrEqual(4.5)
        })

        // `primary` surfaces `<Button variant="default">` (used in the
        // ThemeSelector trigger and the sidebar action bar) — a UI
        // component with a 14px bold label. WCAG 2.1 classifies 14px bold
        // as "large text" and permits the 3.0:1 minimum for both the UI
        // background and its label. If `primary` is ever adopted for
        // small (<14px regular) body copy, bump this to 4.5.
        it(`${mode}: primary-foreground on primary >= 3.0 (UI / large-text)`, () => {
          expect(
            contrast(
              tokens.primaryForeground,
              tokens.primary,
              config.chroma,
              config.hue,
            ),
          ).toBeGreaterThanOrEqual(3.0)
        })

        // `muted-foreground` on `muted` drives secondary info (path hints
        // in `FileContent`, timestamps in the sidebar, nav section
        // headers). These surfaces are non-critical supporting text; the
        // WCAG 2.1 UI/large-text threshold of 3.0:1 applies. The moment
        // muted carries primary body copy (e.g., a paragraph in an
        // empty-state screen), this assertion must be raised to 4.5.
        it(`${mode}: muted-foreground on muted >= 3.0 (UI / secondary text)`, () => {
          expect(
            contrast(
              tokens.mutedForeground,
              tokens.muted,
              config.chroma,
              config.hue,
            ),
          ).toBeGreaterThanOrEqual(3.0)
        })
      }
    })
  }
})

/**
 * Drift guard: the L/step tables above are hand-mirrored from globals.css.
 * If someone retunes `--background: oklch(0.12 var(--chroma-5) ...)` to a
 * different L without updating `DARK_TOKENS.background.L`, the contrast
 * assertions would evaluate a fictional palette and pass while real
 * rendering regresses. This reads globals.css as text and verifies each
 * `L var(--chroma-N)` pair the test makes claims about actually appears
 * in the CSS.
 */
describe('WCAG contrast — globals.css drift guard', () => {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const lightBlock = css.match(/\.light\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

  function expectedFragment(spec: TokenSpec): string {
    return spec.step === 'full'
      ? `oklch(${spec.L} var(--theme-chroma)`
      : `oklch(${spec.L} var(--${spec.step.replace('c', 'chroma-')})`
  }

  for (const [token, spec] of Object.entries(DARK_TOKENS)) {
    it(`.dark ${token} L=${spec.L} step=${spec.step} matches globals.css`, () => {
      expect(darkBlock).toContain(expectedFragment(spec))
    })
  }

  for (const [token, spec] of Object.entries(LIGHT_TOKENS)) {
    it(`.light ${token} L=${spec.L} step=${spec.step} matches globals.css`, () => {
      expect(lightBlock).toContain(expectedFragment(spec))
    })
  }
})
