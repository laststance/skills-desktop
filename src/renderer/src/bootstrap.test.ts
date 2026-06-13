/**
 * Regression tests for the inline pre-hydration bootstrap in
 * `src/renderer/index.html`. The IIFE runs before the JS bundle loads, so
 * it cannot import modules; this test extracts the literal script text and
 * evaluates it against a happy-dom document for each storage state we care
 * about.
 *
 * Covers the upgrade path the prior review caught: a user still on
 * pre-chroma (v0) storage sees a neutral-dark flash between
 * DOMContentLoaded and ACTION_HYDRATE_COMPLETE (~100ms) unless the
 * bootstrap knows how to read the legacy `presetType` field.
 *   v0 color   → --theme-chroma: 0.16
 *   v0 neutral → --theme-chroma: 0
 *
 * Also enforces two drift guards between TypeScript constants and the
 * inline script literals so renaming either side fails loudly.
 *
 * @vitest-environment happy-dom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInThisContext } from 'node:vm'

import { beforeEach, describe, expect, it } from 'vitest'

import { COLOR_PRESET_CHROMA, PERSIST_STORAGE_KEY } from '@/shared/constants'

// Vitest runs from repo root, so `process.cwd()` is stable across both the
// `node` and `browser` projects. Resolving from it avoids `import.meta.url`
// quirks (under vite-node, `import.meta.url` can be a module specifier
// instead of a `file:` URL).
//
// Both windows ship a duplicated copy of the bootstrap IIFE — the main app
// window and the Settings window — so every test runs against both to catch
// drift between them (a fix landing in one but not the other).
const HTML_PATHS = {
  main: resolve(process.cwd(), 'src/renderer/index.html'),
  settings: resolve(process.cwd(), 'src/renderer/settings/index.html'),
} as const

interface StorageMock {
  clear: () => void
  getItem: (key: string) => string | null
  key: (index: number) => string | null
  readonly length: number
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

/**
 * Locate the inline bootstrap IIFE by finding the `<script>` block that
 * contains the PERSIST_STORAGE_KEY literal. Anchoring on the marker is
 * more robust than grabbing the first `<script>` — if someone later adds
 * an analytics ping or a CSP meta-script above the bootstrap, or wraps
 * the IIFE in `<script nonce="…">`, a naive regex would silently evaluate
 * the wrong block.
 *
 * Fails loudly if no script containing the marker is found — either the
 * bootstrap was deleted, moved to an external file, or the PERSIST_STORAGE_KEY
 * literal was renamed without updating this extractor.
 */
function loadBootstrapScript(htmlPath: string): string {
  const html = readFileSync(htmlPath, 'utf8')
  // Match `<script ...>...</script>` with any attributes; capture the body
  // only when it contains the storage-key literal. The non-greedy `[^]*?`
  // keeps multiple scripts from being swallowed into a single match.
  const scriptRegex =
    /<script\b[^>]*>([\s\S]*?localStorage\.getItem\(\s*['"]skills-desktop-state['"]\s*\)[\s\S]*?)<\/script>/
  const match = html.match(scriptRegex)
  if (!match) {
    throw new Error(
      'No inline <script> containing the PERSIST_STORAGE_KEY bootstrap was ' +
        'found in index.html. The pre-hydration bootstrap must stay inline ' +
        'and read from localStorage directly so the blocking-script ' +
        'first-paint contract holds.',
    )
  }
  return match[1]
}

/**
 * Build an isolated in-memory Storage implementation for this test file.
 * @returns Storage-like object with deterministic get/set/remove/clear behavior.
 * @example
 * const storage = createStorageMock()
 * storage.setItem('k', 'v')
 * storage.getItem('k') // => 'v'
 */
function createStorageMock(): StorageMock {
  const entries = new Map<string, string>()
  return {
    clear: () => {
      entries.clear()
    },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() {
      return entries.size
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}

/**
 * Install a fresh storage mock on the global object so the inline bootstrap
 * script reads from a predictable storage implementation.
 * @returns The installed storage mock for direct use in tests.
 * @example
 * const storage = installStorageMock()
 * storage.setItem('x', '1')
 */
function installStorageMock(): StorageMock {
  const storage = createStorageMock()
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  })
  return storage
}

function runBootstrap(htmlPath: string): void {
  const script = loadBootstrapScript(htmlPath)
  // Run the inline script in the global VM context so test-file locals cannot
  // leak in while `document` and `localStorage` stay available.
  runInThisContext(script, { filename: 'renderer-theme-bootstrap.js' })
}

beforeEach(() => {
  installStorageMock()
  localStorage.clear()
  const root = document.documentElement
  root.style.removeProperty('--theme-hue')
  root.style.removeProperty('--theme-chroma')
  root.classList.remove('light')
  root.classList.remove('tone-tinted')
  // index.html ships with `<html class="dark">`; simulate that baseline so
  // tests observe the bootstrap's effect on the same DOM the browser sees.
  root.classList.add('dark')
})

describe.each(Object.entries(HTML_PATHS))(
  'bootstrap — pre-hydration theme IIFE (%s window)',
  (_windowName, htmlPath) => {
    it('keeps the inline bootstrap reading the storage key so first paint stays in sync with persisted state', () => {
      // Arrange — read index.html as shipped
      const html = readFileSync(htmlPath, 'utf8')

      // Act — (the file content is the subject under inspection)

      // Assert — the bootstrap still references the literal storage key
      expect(html).toContain(`'${PERSIST_STORAGE_KEY}'`)
    })

    it('keeps the inline bootstrap referencing the color-preset chroma so renamed constants fail loudly', () => {
      // Arrange — read index.html as shipped
      const html = readFileSync(htmlPath, 'utf8')

      // Act — (the file content is the subject under inspection)

      // Assert — the bootstrap still references the literal chroma constant
      expect(html).toContain(`'${COLOR_PRESET_CHROMA}'`)
    })

    it('keeps the inline tinted-gate upper bound pinned to COLOR_PRESET_CHROMA so a constant bump cannot desync first paint', () => {
      // Arrange — read index.html as shipped. The .tone-tinted gate uses a
      // BARE `chromaVal < 0.16` comparison (not the quoted setProperty arg the
      // test above guards). If COLOR_PRESET_CHROMA is retuned but this bare
      // literal is not, the pre-hydration bootstrap and the post-hydration
      // listener (which imports the constant) disagree at the chroma boundary
      // → flash of the wrong gray base on first paint.
      const html = readFileSync(htmlPath, 'utf8')

      // Act — (the file content is the subject under inspection)

      // Assert — the bare upper-bound comparison still matches the constant
      expect(html).toContain(`chromaVal < ${COLOR_PRESET_CHROMA}`)
    })

    it('paints the default dark theme with no CSS vars when storage is empty', () => {
      // Arrange — beforeEach already cleared storage and set the .dark baseline

      // Act
      runBootstrap(htmlPath)

      // Assert — stays on default .dark and writes no theme CSS variables
      const root = document.documentElement
      expect(root.classList.contains('dark')).toBe(true)
      expect(root.classList.contains('light')).toBe(false)
      expect(root.style.getPropertyValue('--theme-hue')).toBe('')
      expect(root.style.getPropertyValue('--theme-chroma')).toBe('')
    })

    it('falls back to the default dark theme when persisted state is malformed JSON', () => {
      // Arrange — corrupt the persisted blob so JSON.parse will throw
      localStorage.setItem(PERSIST_STORAGE_KEY, 'not-json{')

      // Act
      runBootstrap(htmlPath)

      // Assert — parse failure keeps .dark and writes no hue variable
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(
        document.documentElement.style.getPropertyValue('--theme-hue'),
      ).toBe('')
    })

    it('leaves the DOM untouched when the persisted theme slot is null', () => {
      // Arrange — valid envelope but an explicitly null theme
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({ version: 1, state: { theme: null } }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — a null theme bails early, keeping .dark and no hue variable
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(
        document.documentElement.style.getPropertyValue('--theme-hue'),
      ).toBe('')
    })

    it('applies hue and chroma and keeps dark mode for a v1 color preset', () => {
      // Arrange — a v1 cyan color preset in dark mode
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: {
            theme: {
              hue: 195,
              chroma: COLOR_PRESET_CHROMA,
              mode: 'dark',
              preset: 'cyan',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — the stored hue/chroma paint through and .dark is preserved
      const root = document.documentElement
      expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
      expect(Number(root.style.getPropertyValue('--theme-chroma'))).toBeCloseTo(
        COLOR_PRESET_CHROMA,
      )
      expect(root.classList.contains('dark')).toBe(true)
      expect(root.classList.contains('light')).toBe(false)
    })

    it('zeroes chroma and flips to light mode for a v1 neutral preset', () => {
      // Arrange — a v1 neutral-light preset in light mode
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: {
            theme: {
              hue: 0,
              chroma: 0,
              mode: 'light',
              preset: 'neutral-light',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — chroma collapses to 0 and the baseline .dark flips to .light
      const root = document.documentElement
      expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
      expect(root.classList.contains('light')).toBe(true)
      expect(root.classList.contains('dark')).toBe(false)
    })

    it('derives chroma from the legacy presetType so v0 color users skip the neutral-dark flash', () => {
      // Regression guard for post-landing finding MAJOR-2: the v1 bootstrap
      // only read `t.chroma`, so any user still on v0 storage saw a
      // neutral-dark flash for ~100ms until ACTION_HYDRATE_COMPLETE fired.
      // Arrange — a v0 envelope with legacy presetType=color and no chroma field
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 0,
          state: {
            theme: {
              hue: 195,
              mode: 'dark',
              preset: 'cyan',
              presetType: 'color',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — chroma is derived from COLOR_PRESET_CHROMA and .dark is kept
      const root = document.documentElement
      expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
      expect(Number(root.style.getPropertyValue('--theme-chroma'))).toBeCloseTo(
        COLOR_PRESET_CHROMA,
      )
      expect(root.classList.contains('dark')).toBe(true)
    })

    it('zeroes chroma for a legacy v0 neutral preset', () => {
      // Arrange — a v0 envelope with legacy presetType=neutral and no chroma field
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 0,
          state: {
            theme: {
              hue: 0,
              mode: 'light',
              preset: 'neutral-light',
              presetType: 'neutral',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — legacy neutral yields chroma 0 and flips to .light
      const root = document.documentElement
      expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
      expect(root.classList.contains('light')).toBe(true)
    })

    it('adds the tone-tinted gray base for a tinted-neutral preset so it does not flash the crisp ramp', () => {
      // Arrange — a persisted tinted-neutral preset (zinc-dark, chroma 0.05)
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: {
            theme: {
              hue: 265,
              chroma: 0.05,
              mode: 'dark',
              preset: 'zinc-dark',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — tinted chroma (0 < 0.05 < 0.16) gets the softened gray base
      const root = document.documentElement
      expect(root.classList.contains('tone-tinted')).toBe(true)
      expect(root.classList.contains('dark')).toBe(true)
    })

    it('omits the tone-tinted gray base for a full-color preset so its surfaces stay crisp', () => {
      // Arrange — a persisted full-color preset (cyan, chroma 0.16)
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: {
            theme: {
              hue: 195,
              chroma: COLOR_PRESET_CHROMA,
              mode: 'dark',
              preset: 'cyan',
            },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — color presets keep the crisp base ramp, no tone-tinted
      expect(document.documentElement.classList.contains('tone-tinted')).toBe(
        false,
      )
    })

    it('omits the tone-tinted gray base for the pure-neutral default so the default appearance is unchanged', () => {
      // Arrange — a persisted pure-neutral preset (chroma 0)
      localStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: {
            theme: { hue: 0, chroma: 0, mode: 'dark', preset: 'neutral-dark' },
          },
        }),
      )

      // Act
      runBootstrap(htmlPath)

      // Assert — pure neutral keeps the crisp base ramp, no tone-tinted
      expect(document.documentElement.classList.contains('tone-tinted')).toBe(
        false,
      )
    })
  },
)

/**
 * Extract the executable IIFE (`;(function () { … })()`) from a window's
 * inline bootstrap, dropping the leading explanatory comment — which is
 * intentionally worded differently per window — so two copies can be
 * compared on logic alone.
 */
function extractBootstrapIife(htmlPath: string): string {
  const script = loadBootstrapScript(htmlPath)
  const iifeStart = script.indexOf(';(function')
  if (iifeStart < 0) {
    throw new Error(`No bootstrap IIFE found in ${htmlPath}`)
  }
  return script.slice(iifeStart)
}

/**
 * The two windows ship duplicated bootstrap IIFEs. This guards against a fix
 * landing in one copy but not the other — the failure mode that left the
 * Settings window flashing while the main window was already correct.
 */
describe('bootstrap — main and settings windows stay in lockstep', () => {
  it('keeps the main + settings bootstrap IIFEs identical so a fix lands in both windows', () => {
    // Arrange — extract each window's executable IIFE (sans leading comment)
    const mainIife = extractBootstrapIife(HTML_PATHS.main)
    const settingsIife = extractBootstrapIife(HTML_PATHS.settings)

    // Act — (the extracted IIFEs are the subject under comparison)

    // Assert — both windows run the exact same pre-hydration logic
    expect(settingsIife).toBe(mainIife)
  })
})
