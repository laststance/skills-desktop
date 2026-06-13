import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('shiki/themes/github-dark.mjs', () => ({
  default: { name: 'github-dark' },
}))
vi.mock('shiki/themes/github-light.mjs', () => ({
  default: { name: 'github-light' },
}))

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

    // Act — drive each lazy loader so its dynamic import actually executes.
    const loadedGrammars = await Promise.all(
      languageIds.map(async (languageId) =>
        capturedConfig!.langs[languageId](),
      ),
    )

    // Assert — every loader resolves to a grammar payload (the stub module).
    expect(loadedGrammars).toHaveLength(34)
    for (const grammar of loadedGrammars) {
      expect(grammar).toBeDefined()
    }
    // Spot-check that a specific loader resolves the expected grammar module.
    const bashGrammar = await capturedConfig!.langs.bash()
    expect(bashGrammar).toEqual({ default: [{ name: 'bash' }] })
  })

  it('offers the github-dark and github-light themes for the preview pane', async () => {
    // Arrange
    await import('./shikiPreview')
    const capturedConfig = shikiCoreMocks.capturedBundleConfig.value
    expect(capturedConfig).not.toBeNull()

    // Act — invoke both theme loaders to run their dynamic imports.
    const darkTheme = await capturedConfig!.themes['github-dark']()
    const lightTheme = await capturedConfig!.themes['github-light']()

    // Assert
    expect(Object.keys(capturedConfig!.themes).sort()).toEqual([
      'github-dark',
      'github-light',
    ])
    expect(darkTheme).toEqual({ default: { name: 'github-dark' } })
    expect(lightTheme).toEqual({ default: { name: 'github-light' } })
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
