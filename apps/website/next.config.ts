import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// pnpm links workspace dependencies from the repository root, so Turbopack and
// output file tracing must start there rather than at apps/website.
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ['@skills-desktop/unsplash-contract'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
