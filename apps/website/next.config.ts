import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const websiteRoot = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  turbopack: {
    root: websiteRoot,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
