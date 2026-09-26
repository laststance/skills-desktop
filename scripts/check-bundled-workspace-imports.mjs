/**
 * Fail the build when the Electron main/preload output still imports a
 * workspace package at runtime.
 *
 * Why it exists: workspace packages such as `@skills-desktop/unsplash-contract`
 * ship TypeScript source and are devDependencies of apps/desktop, so
 * electron-builder never copies them into the asar. If electron-vite ever
 * externalizes one (for example after it moves to `dependencies`), the
 * packaged app crashes at launch with "Cannot find module" while e2e still
 * passes, because e2e runs from the source tree where node_modules resolves it.
 *
 * When it runs: the `build` CI job, after `pnpm build`, via the root
 * `check:bundled-workspace` script.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const WORKSPACE_SCOPE = '@skills-desktop/'
const outRoot = path.resolve(import.meta.dirname, '../apps/desktop/out')
const bundleDirs = ['main', 'preload'].map((dir) => path.join(outRoot, dir))

// Matches static imports (minified `import"x"` included), re-exports, dynamic
// import() and require() of the scope, with any quote style a bundler may emit.
const runtimeImportPattern = new RegExp(
  String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["'\`]${WORKSPACE_SCOPE.replace('/', '\\/')}[^"'\`]*["'\`]`,
)

/** Recursively lists bundle files under a directory. */
function listBundleFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const entryPath = path.join(dir, entry)
    // Descend into chunk folders; only JS bundles can hold runtime imports.
    if (statSync(entryPath).isDirectory()) return listBundleFiles(entryPath)
    return /\.(?:c|m)?js$/.test(entry) ? [entryPath] : []
  })
}

const missingDirs = bundleDirs.filter((dir) => {
  try {
    return !statSync(dir).isDirectory()
  } catch {
    return true
  }
})
// Without build output the check would pass vacuously, so treat it as an error.
if (missingDirs.length > 0) {
  console.error(
    `Missing Electron build output: ${missingDirs.join(', ')}. Run \`pnpm build\` first.`,
  )
  process.exit(1)
}

const bundleFiles = bundleDirs.flatMap(listBundleFiles)
// Empty output dirs would also pass vacuously (e.g. a renamed bundle extension).
if (bundleFiles.length === 0) {
  console.error(
    `No Electron bundles found under ${bundleDirs.join(', ')}. Run \`pnpm build\` first.`,
  )
  process.exit(1)
}

const offenders = bundleFiles.filter((file) =>
  runtimeImportPattern.test(readFileSync(file, 'utf8')),
)

if (offenders.length > 0) {
  console.error(
    `These Electron bundles import a ${WORKSPACE_SCOPE}* workspace package at runtime, which the packaged app cannot resolve:`,
  )
  for (const file of offenders)
    console.error(`  - ${path.relative(process.cwd(), file)}`)
  console.error(
    'Keep workspace packages in apps/desktop devDependencies so electron-vite bundles them.',
  )
  process.exit(1)
}

console.log(
  `OK: no runtime ${WORKSPACE_SCOPE}* imports in apps/desktop/out/{main,preload}.`,
)
