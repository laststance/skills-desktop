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

import { beforeEach, describe, expect, it } from 'vitest'

import {
  COLOR_PRESET_CHROMA,
  PERSIST_STORAGE_KEY,
} from '../../shared/constants'

// Vitest runs from repo root, so `process.cwd()` is stable across both the
// `node` and `browser` projects. Resolving from it avoids `import.meta.url`
// quirks (under vite-node, `import.meta.url` can be a module specifier
// instead of a `file:` URL).
const HTML_PATH = resolve(process.cwd(), 'src/renderer/index.html')

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
function loadBootstrapScript(): string {
  const html = readFileSync(HTML_PATH, 'utf8')
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

function runBootstrap(): void {
  const script = loadBootstrapScript()
  // Using `new Function` (not `eval`) keeps the script in its own lexical
  // scope so test-file locals can't leak in. The IIFE wrapper inside the
  // script provides its own isolation on top of that.
  new Function(script)()
}

beforeEach(() => {
  installStorageMock()
  localStorage.clear()
  const root = document.documentElement
  root.style.removeProperty('--theme-hue')
  root.style.removeProperty('--theme-chroma')
  root.classList.remove('light')
  // index.html ships with `<html class="dark">`; simulate that baseline so
  // tests observe the bootstrap's effect on the same DOM the browser sees.
  root.classList.add('dark')
})

describe('bootstrap — pre-hydration theme IIFE', () => {
  it('drift guard: index.html contains PERSIST_STORAGE_KEY literal', () => {
    const html = readFileSync(HTML_PATH, 'utf8')
    expect(html).toContain(`'${PERSIST_STORAGE_KEY}'`)
  })

  it('drift guard: index.html contains COLOR_PRESET_CHROMA literal', () => {
    const html = readFileSync(HTML_PATH, 'utf8')
    expect(html).toContain(`'${COLOR_PRESET_CHROMA}'`)
  })

  it('no storage → keeps default .dark, sets no CSS vars', () => {
    runBootstrap()
    const root = document.documentElement
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
    expect(root.style.getPropertyValue('--theme-hue')).toBe('')
    expect(root.style.getPropertyValue('--theme-chroma')).toBe('')
  })

  it('malformed JSON → falls back to default .dark', () => {
    localStorage.setItem(PERSIST_STORAGE_KEY, 'not-json{')
    runBootstrap()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--theme-hue')).toBe(
      '',
    )
  })

  it('null theme slot → bails without touching DOM', () => {
    localStorage.setItem(
      PERSIST_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { theme: null } }),
    )
    runBootstrap()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--theme-hue')).toBe(
      '',
    )
  })

  it('v1 color preset (cyan dark) → applies hue, chroma, keeps .dark', () => {
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
    runBootstrap()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
    expect(Number(root.style.getPropertyValue('--theme-chroma'))).toBeCloseTo(
      COLOR_PRESET_CHROMA,
    )
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
  })

  it('v1 neutral preset (neutral-light) → chroma 0, flips to .light', () => {
    localStorage.setItem(
      PERSIST_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          theme: { hue: 0, chroma: 0, mode: 'light', preset: 'neutral-light' },
        },
      }),
    )
    runBootstrap()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('v0 color preset (legacy presetType=color, no chroma) → chroma derived from COLOR_PRESET_CHROMA', () => {
    // Regression guard for post-landing finding MAJOR-2: the v1 bootstrap
    // only read `t.chroma`, so any user still on v0 storage saw a
    // neutral-dark flash for ~100ms until ACTION_HYDRATE_COMPLETE fired.
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
    runBootstrap()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
    expect(Number(root.style.getPropertyValue('--theme-chroma'))).toBeCloseTo(
      COLOR_PRESET_CHROMA,
    )
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('v0 neutral preset (legacy presetType=neutral, no chroma) → chroma 0', () => {
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
    runBootstrap()
    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
    expect(root.classList.contains('light')).toBe(true)
  })
})
