import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CODE_THEME_DEFINITIONS } from '@/shared/constants'

/**
 * The focused Shiki bundle in `shikiPreview.ts` registers each grammar as a
 * lazy `() => import('shiki/langs/<lang>.mjs')` loader and wires up a singleton
 * `codeToHtml` shorthand. These tests mock `shiki/core` so we can (a) assert the
 * exact set of grammars the preview pane ships, (b) drive every lazy loader so
 * its dynamic import actually runs, and (c) confirm the engine is the WASM-free
 * JavaScript regex engine — all without pulling Oniguruma into the node lane.
 */

// vi.hoisted so the spies exist before the mock factory and the SUT import run.
const shikiCoreMocks = vi.hoisted(() => {
  return {
    capturedBundleConfig: {
      value: null as {
        langs: Record<string, () => Promise<unknown>>
        themes: Record<string, () => Promise<unknown>>
        engine: () => unknown
      } | null,
    },
    createBundledHighlighter: vi.fn(),
    createSingletonShorthands: vi.fn(),
    fakeCodeToHtml: vi.fn(),
    createdHighlighter: { __brand: 'preview-highlighter' as const },
    createJavaScriptRegexEngine: vi.fn(),
    fakeEngine: { __brand: 'js-regex-engine' as const },
  }
})

vi.mock('shiki/core', () => {
  // createBundledHighlighter captures the config so the test can replay the
  // lazy lang/theme loaders and the engine factory the SUT passed in.
  shikiCoreMocks.createBundledHighlighter.mockImplementation((bundleConfig) => {
    shikiCoreMocks.capturedBundleConfig.value = bundleConfig
    return shikiCoreMocks.createdHighlighter
  })
  // createSingletonShorthands returns the shorthand surface; the SUT only
  // destructures codeToHtml from it.
  shikiCoreMocks.createSingletonShorthands.mockReturnValue({
    codeToHtml: shikiCoreMocks.fakeCodeToHtml,
  })
  return {
    createBundledHighlighter: shikiCoreMocks.createBundledHighlighter,
    createSingletonShorthands: shikiCoreMocks.createSingletonShorthands,
  }
})

vi.mock('shiki/engine/javascript', () => {
  shikiCoreMocks.createJavaScriptRegexEngine.mockReturnValue(
    shikiCoreMocks.fakeEngine,
  )
  return {
    createJavaScriptRegexEngine: shikiCoreMocks.createJavaScriptRegexEngine,
  }
})

// Every grammar module the SUT lazily imports is stubbed with a lightweight
// payload so invoking a loader never reaches the real (heavy) Shiki grammar.
const stubLangModule = (
  languageId: string,
): { default: [{ name: string }] } => ({
  default: [{ name: languageId }],
})

vi.mock('shiki/langs/bash.mjs', () => stubLangModule('bash'))
vi.mock('shiki/langs/c.mjs', () => stubLangModule('c'))
vi.mock('shiki/langs/cpp.mjs', () => stubLangModule('cpp'))
vi.mock('shiki/langs/csharp.mjs', () => stubLangModule('csharp'))
vi.mock('shiki/langs/css.mjs', () => stubLangModule('css'))
vi.mock('shiki/langs/dockerfile.mjs', () => stubLangModule('dockerfile'))
vi.mock('shiki/langs/dotenv.mjs', () => stubLangModule('dotenv'))
vi.mock('shiki/langs/fish.mjs', () => stubLangModule('fish'))
vi.mock('shiki/langs/go.mjs', () => stubLangModule('go'))
vi.mock('shiki/langs/html.mjs', () => stubLangModule('html'))
vi.mock('shiki/langs/ini.mjs', () => stubLangModule('ini'))
vi.mock('shiki/langs/java.mjs', () => stubLangModule('java'))
vi.mock('shiki/langs/javascript.mjs', () => stubLangModule('javascript'))
vi.mock('shiki/langs/json.mjs', () => stubLangModule('json'))
vi.mock('shiki/langs/jsonc.mjs', () => stubLangModule('jsonc'))
vi.mock('shiki/langs/jsx.mjs', () => stubLangModule('jsx'))
vi.mock('shiki/langs/kotlin.mjs', () => stubLangModule('kotlin'))
vi.mock('shiki/langs/lua.mjs', () => stubLangModule('lua'))
vi.mock('shiki/langs/make.mjs', () => stubLangModule('make'))
vi.mock('shiki/langs/md.mjs', () => stubLangModule('markdown'))
vi.mock('shiki/langs/mdx.mjs', () => stubLangModule('mdx'))
vi.mock('shiki/langs/php.mjs', () => stubLangModule('php'))
vi.mock('shiki/langs/python.mjs', () => stubLangModule('python'))
vi.mock('shiki/langs/ruby.mjs', () => stubLangModule('ruby'))
vi.mock('shiki/langs/rust.mjs', () => stubLangModule('rust'))
vi.mock('shiki/langs/scss.mjs', () => stubLangModule('scss'))
vi.mock('shiki/langs/sql.mjs', () => stubLangModule('sql'))
vi.mock('shiki/langs/swift.mjs', () => stubLangModule('swift'))
vi.mock('shiki/langs/toml.mjs', () => stubLangModule('toml'))
vi.mock('shiki/langs/tsx.mjs', () => stubLangModule('tsx'))
vi.mock('shiki/langs/typescript.mjs', () => stubLangModule('typescript'))
vi.mock('shiki/langs/xml.mjs', () => stubLangModule('xml'))
vi.mock('shiki/langs/yaml.mjs', () => stubLangModule('yaml'))
vi.mock('shiki/langs/zsh.mjs', () => stubLangModule('zsh'))

// Each Shiki theme module the SUT lazily imports is stubbed with the same
// `{ default: { name } }` shape, so driving a loader proves the registered key
// is wired to the matching theme module (not a mismatched one).
const stubThemeModule = (themeName: string): { default: { name: string } } => ({
  default: { name: themeName },
})

vi.mock('shiki/themes/github-dark.mjs', () => stubThemeModule('github-dark'))
vi.mock('shiki/themes/github-light.mjs', () => stubThemeModule('github-light'))
vi.mock('shiki/themes/light-plus.mjs', () => stubThemeModule('light-plus'))
vi.mock('shiki/themes/dark-plus.mjs', () => stubThemeModule('dark-plus'))
vi.mock('shiki/themes/vitesse-light.mjs', () =>
  stubThemeModule('vitesse-light'),
)
vi.mock('shiki/themes/vitesse-dark.mjs', () => stubThemeModule('vitesse-dark'))
vi.mock('shiki/themes/one-light.mjs', () => stubThemeModule('one-light'))
vi.mock('shiki/themes/one-dark-pro.mjs', () => stubThemeModule('one-dark-pro'))
vi.mock('shiki/themes/catppuccin-latte.mjs', () =>
  stubThemeModule('catppuccin-latte'),
)
vi.mock('shiki/themes/catppuccin-mocha.mjs', () =>
  stubThemeModule('catppuccin-mocha'),
)

describe('shikiPreview bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-prime the mock implementations cleared above so each test sees the
    // captured config and the stub return values again.
    shikiCoreMocks.createBundledHighlighter.mockImplementation(
      (bundleConfig) => {
        shikiCoreMocks.capturedBundleConfig.value = bundleConfig
        return shikiCoreMocks.createdHighlighter
      },
    )
    shikiCoreMocks.createSingletonShorthands.mockReturnValue({
      codeToHtml: shikiCoreMocks.fakeCodeToHtml,
    })
    shikiCoreMocks.createJavaScriptRegexEngine.mockReturnValue(
      shikiCoreMocks.fakeEngine,
    )
  })

  it('ships syntax highlighting for exactly the skill-repo languages the preview pane lists', async () => {
    // Arrange — the exact grammar set DESIGN intends the read-only preview to
    // cover. Hard-coded so adding/removing a grammar in the SUT fails this test.
    const expectedLanguageIds = [
      'bash',
      'c',
      'cpp',
      'csharp',
      'css',
      'dockerfile',
      'dotenv',
      'fish',
      'go',
      'html',
      'ini',
      'java',
      'javascript',
      'json',
      'jsonc',
      'jsx',
      'kotlin',
      'lua',
      'make',
      'markdown',
      'mdx',
      'php',
      'python',
      'ruby',
      'rust',
      'scss',
      'sql',
      'swift',
      'toml',
      'tsx',
      'typescript',
      'xml',
      'yaml',
      'zsh',
    ]

    // Act
    await import('./shikiPreview')
    const capturedConfig = shikiCoreMocks.capturedBundleConfig.value

    // Assert
    expect(capturedConfig).not.toBeNull()
    expect(Object.keys(capturedConfig!.langs).sort()).toEqual(
      [...expectedLanguageIds].sort(),
    )
  })

  it('loads each grammar module on demand through its registered loader', async () => {
    // Arrange
    await import('./shikiPreview')
    const capturedConfig = shikiCoreMocks.capturedBundleConfig.value
    expect(capturedConfig).not.toBeNull()
    const languageIds = Object.keys(capturedConfig!.langs)

    // Act — drive each lazy loader so its dynamic import actually executes,
    // keeping the registered key paired with the grammar module it resolves to.
    const loadedGrammarsByLanguageId = await Promise.all(
      languageIds.map(async (languageId) => ({
        languageId,
        grammar: await capturedConfig!.langs[languageId](),
      })),
    )

    // Assert — every registered key resolves to the grammar module whose name
    // matches that key, so a mis-wired loader (e.g. `typescript` pointing at
    // `python.mjs`) is caught even though the total grammar count stays 34.
    expect(loadedGrammarsByLanguageId).toHaveLength(34)
    for (const { languageId, grammar } of loadedGrammarsByLanguageId) {
      expect(grammar).toEqual({ default: [{ name: languageId }] })
    }
  })

  it('bundles exactly the light/dark themes every curated pair needs, each wired to its own module', async () => {
    // Arrange — the bundled theme set must be EXACTLY the union of every
    // curated pair's light + dark names. Derived from CODE_THEME_DEFINITIONS
    // (the source of truth) on purpose: this is the drift guard that fails when
    // a pair is added to CODE_THEME_DEFINITIONS but its loaders are not added to
    // shikiPreview.ts (or vice versa) — hard-coding the names would defeat it.
    const expectedThemeNames = CODE_THEME_DEFINITIONS.flatMap((pair) => [
      pair.light,
      pair.dark,
    ])
    await import('./shikiPreview')
    const capturedConfig = shikiCoreMocks.capturedBundleConfig.value
    expect(capturedConfig).not.toBeNull()

    // Assert — the registered theme keys are exactly that derived set.
    expect(Object.keys(capturedConfig!.themes).sort()).toEqual(
      [...expectedThemeNames].sort(),
    )

    // Act — drive every theme loader so its dynamic import runs, keeping the
    // registered key paired with the module it resolves to.
    const loadedThemesByName = await Promise.all(
      expectedThemeNames.map(async (themeName) => ({
        themeName,
        themeModule: await capturedConfig!.themes[themeName](),
      })),
    )

    // Assert — every registered key resolves to the theme module whose name
    // matches it, so a mis-wired loader (e.g. 'one-dark-pro' pointing at
    // one-light.mjs) is caught even though the total theme count stays 10.
    expect(loadedThemesByName).toHaveLength(10)
    for (const { themeName, themeModule } of loadedThemesByName) {
      expect(themeModule).toEqual({ default: { name: themeName } })
    }
  })

  it('highlights offline using the WASM-free JavaScript regex engine', async () => {
    // Arrange
    await import('./shikiPreview')
    const capturedConfig = shikiCoreMocks.capturedBundleConfig.value
    expect(capturedConfig).not.toBeNull()

    // Act — invoke the engine factory the SUT registered.
    const engine = capturedConfig!.engine()

    // Assert — it is the JavaScript regex engine, not the Oniguruma WASM one.
    expect(shikiCoreMocks.createJavaScriptRegexEngine).toHaveBeenCalledTimes(1)
    expect(engine).toBe(shikiCoreMocks.fakeEngine)
  })

  it('exposes a codeToHtml shorthand wired to the focused preview highlighter', async () => {
    // Arrange
    const shikiPreviewModule = await import('./shikiPreview')

    // Act
    const { codeToHtml } = shikiPreviewModule

    // Assert — the named export is exactly the singleton shorthand produced from
    // the focused preview highlighter (not some other Shiki entry point).
    expect(codeToHtml).toBe(shikiCoreMocks.fakeCodeToHtml)
    expect(typeof codeToHtml).toBe('function')
  })
})
