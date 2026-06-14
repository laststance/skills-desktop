import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Shiki modules used by the skill file preview. Vitest browser mode reloads
 * tests when it discovers new optimized dependencies mid-run; keeping the
 * focused highlighter bundle explicit makes those component tests stable.
 */
const shikiPreviewDeps = [
  'shiki/core',
  'shiki/engine/javascript',
  'shiki/langs/bash.mjs',
  'shiki/langs/c.mjs',
  'shiki/langs/cpp.mjs',
  'shiki/langs/csharp.mjs',
  'shiki/langs/css.mjs',
  'shiki/langs/dockerfile.mjs',
  'shiki/langs/dotenv.mjs',
  'shiki/langs/fish.mjs',
  'shiki/langs/go.mjs',
  'shiki/langs/html.mjs',
  'shiki/langs/ini.mjs',
  'shiki/langs/java.mjs',
  'shiki/langs/javascript.mjs',
  'shiki/langs/json.mjs',
  'shiki/langs/jsonc.mjs',
  'shiki/langs/jsx.mjs',
  'shiki/langs/kotlin.mjs',
  'shiki/langs/lua.mjs',
  'shiki/langs/make.mjs',
  'shiki/langs/md.mjs',
  'shiki/langs/mdx.mjs',
  'shiki/langs/php.mjs',
  'shiki/langs/python.mjs',
  'shiki/langs/ruby.mjs',
  'shiki/langs/rust.mjs',
  'shiki/langs/scss.mjs',
  'shiki/langs/sql.mjs',
  'shiki/langs/swift.mjs',
  'shiki/langs/toml.mjs',
  'shiki/langs/tsx.mjs',
  'shiki/langs/typescript.mjs',
  'shiki/langs/xml.mjs',
  'shiki/langs/yaml.mjs',
  'shiki/langs/zsh.mjs',
  'shiki/themes/github-dark.mjs',
  'shiki/themes/github-light.mjs',
] as const

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    // React and react-dom MUST resolve to a single instance. Without dedupe,
    // vitest-browser-react bundles its own copy while react-redux pulls the
    // root copy, leaving hook dispatchers disconnected and `useMemo` null.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    // Coverage config lives at the root so v8 merges results from both
    // node + browser projects into a single lcov report. Codecov consumes
    // `coverage/lcov.info`; `text` mirrors the same numbers in CI logs so
    // a regression is visible without opening codecov.io.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Exclusions follow the same intent as `.fallowrc.jsonc`: shadcn/ui
      // primitives are scaffolded as full kits (every export reserved for
      // future composition), and *.d.ts / test files don't carry runtime
      // logic worth measuring.
      //
      // Electron-runtime exclusions: v8 only instruments code the vitest node
      // + chromium lanes execute. The files below run inside the Electron
      // main/preload process (app lifecycle, the ipcMain handler boundary, the
      // contextBridge preload, and the two ReactDOM bootstrap entries). The
      // boot/preload entries are exercised only behaviorally by the Playwright
      // e2e suite (`pnpm test:e2e`), which v8 does not instrument — so counting
      // them here would only ever read ~0% and make the gate meaningless.
      // `src/main/ipc/**` is excluded as a whole directory per the explicit P3
      // boot/IPC/preload scope, and the honest caveat is on the inline note
      // below: only 4 of its 17 files carry node-lane tests, even the tested
      // orchestration (skills.ts) is exercised-but-undercovered, and the rest
      // lean on e2e. The carve-out therefore trades IPC coverage SIGNAL for the
      // e2e boundary; the gate's real teeth are on the bulk of the domain logic
      // in `src/main/services/**` + `src/main/utils/**` (and the renderer),
      // which run in the node/chromium lanes and ARE held to the ~100% bar.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.browser.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/renderer/src/components/ui/**',
        'src/main/index.ts', // Electron app boot + lifecycle wiring
        'src/main/ipc/**', // ipcMain handler tree — excluded as a directory per the explicit P3 boot/IPC/preload carve-out. Honest caveat: only 4 of 17 files here carry node-lane tests (skills, folder, cliCommand, ipc-schemas), and even the tested orchestration (skills.ts) is integration-EXERCISED but only ~65% lines / ~49% branches COVERED — exercised ≠ covered. The other 13 (settings, sync, update, leaderboard, files, shell, source, skillsCli, agents, window, the typed* registration glue) are reached only by the Playwright e2e suite, which v8 does not instrument. So this carve-out trades IPC coverage SIGNAL for the e2e boundary; the gate's teeth are on the renderer + main/services + main/utils + shared, where the domain logic lives
        'src/preload/**', // contextBridge preload runtime
        'src/renderer/src/main.tsx', // main-window ReactDOM bootstrap
        'src/renderer/settings/main.tsx', // settings-window ReactDOM bootstrap
      ],
      // Coverage gate (the "pragmatic 100%" bar). Achieved at the time of
      // writing: Lines 99.98 / Functions 99.93 / Statements 98.62 / Branches
      // 88.67. We deliberately floor *just below* each rather than at 100
      // because the Chromium (browser) lane's v8/esbuild instrumentation is
      // systematically imprecise on transformed code. A `/* v8 ignore */`
      // directive DOES suppress some browser-lane artifacts — this PR relies on
      // exactly that for the guards in ErrorBoundary / MainContent /
      // SymlinkCleanupDialog — but the diffuse artifacts below resist clean
      // per-site annotation: the transform remaps the hit onto a different
      // statement/function than a directive can target, so they are floored,
      // not chased:
      //   • Statements: JSX / arrow-callback statements map to transformed
      //     positions that never register a hit even when the line + function
      //     DID run (e.g. General.tsx, AgentItem.tsx, CodePreview.tsx all sit
      //     at S:92 despite L:100 F:100). This is the bulk of the stmt/branch
      //     shortfall — diffuse, so it is floored, not ignored.
      //   • Functions: const-arrow `onClick` handlers lose their FNDA hit
      //     attribution (e.g. SkillItem.handleUnlinkClick — clicked & asserted
      //     by the "SkillItem unlink button" specs, yet counted uncovered).
      //   • Lines: multi-line import closing-brace lines are dropped by the
      //     transform (e.g. MainContent.tsx:9 `} from 'lucide-react'`).
      // The node lane (Electron main-process services/utils) IS held to ~100 —
      // its tests + v8 ignore directives work there. Buffers also absorb the
      // per-component jitter these artifacts cause as later phases edit UI.
      thresholds: {
        lines: 99.8,
        functions: 99.8,
        statements: 97,
        branches: 87,
      },
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
          },
          dedupe: ['react', 'react-dom'],
        },
        test: {
          name: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.{ts,tsx}', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
          },
          // Browser project MUST dedupe explicitly — projects don't inherit
          // root-level resolve config. Without this, vitest-browser-react
          // bundles its own React, leaving Radix/react-redux pulling a
          // different React instance. useContext returns null, hooks crash.
          dedupe: ['react', 'react-dom'],
        },
        optimizeDeps: {
          // Pre-bundle heavy deps together so they share React instance in
          // the browser page. Without this, Radix packages get bundled lazily
          // with a stale React reference on first mount.
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-runtime',
            'react-redux',
            '@reduxjs/toolkit',
            'react-grid-layout',
            'react-resizable-panels',
            // Radix's controllable-state hook runs `useState` against whatever
            // React it sees first. If Vite bundles toggle-group lazily it grabs
            // a stale React copy and `useState` returns undefined → render
            // crash. Listing the package here forces it into the shared chunk.
            '@radix-ui/react-toggle-group',
            ...shikiPreviewDeps,
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
