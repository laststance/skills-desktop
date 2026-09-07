import { createHash } from 'node:crypto'

import {
  UNSPLASH_IMAGE_ORIGIN,
  UNSPLASH_RPC_URL,
} from '../../../website/src/lib/constants'

/** Injects a real file-compatible CSP after Vite transforms HTML, hashing only the build's trusted inline bootstraps.
 * @returns HTML with one policy before scripts; only development gains its actual renderer/HMR origins.
 * @example injectRendererContentSecurityPolicy(html) // Packaged file:// pages enforce hashes, not HTTP-only headers.
 */
export function injectRendererContentSecurityPolicy(
  html: string,
  developmentUrl?: string,
): string {
  if (!/<head(?:\s[^>]*)?>/i.test(html))
    throw new Error(
      'Renderer HTML must contain a head for Content Security Policy',
    )
  if (/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(html))
    throw new Error('Renderer Content Security Policy is already defined')
  const scriptHashes = [
    ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  ]
    .filter((match) => {
      if (/(?:^|\s)src\s*=/i.test(match[1])) return false
      const type = match[1].match(
        /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      )
      const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '')
        .trim()
        .toLowerCase()
      // JSON/import maps are data, so their bytes must never authorize an executable script.
      return (
        value === '' ||
        value === 'module' ||
        /^(?:text|application)\/(?:javascript|ecmascript|x-javascript|x-ecmascript)$/.test(
          value,
        ) ||
        /^text\/(?:javascript1\.[0-5]|jscript|livescript)$/.test(value)
      )
    })
    .map(
      (match) =>
        `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`,
    )
  const connections = ["'self'", new URL(UNSPLASH_RPC_URL).origin]
  if (developmentUrl) {
    const renderer = new URL(developmentUrl)
    if (renderer.protocol !== 'http:' && renderer.protocol !== 'https:')
      throw new Error('Development renderer must use HTTP or HTTPS')
    connections.push(renderer.origin)
    renderer.protocol = renderer.protocol === 'https:' ? 'wss:' : 'ws:'
    connections.push(renderer.origin)
  }
  const policy = [
    "default-src 'self' file: app:",
    "base-uri 'self'",
    "object-src 'none'",
    // Shiki may compile WebAssembly; this does not permit JavaScript eval or arbitrary inline scripts.
    `script-src 'self' file: app: 'wasm-unsafe-eval' ${scriptHashes.join(' ')}`.trimEnd(),
    "style-src 'self' 'unsafe-inline' file: app:",
    "font-src 'self' data: file: app:",
    `img-src 'self' data: file: app: ${UNSPLASH_IMAGE_ORIGIN}`,
    `connect-src ${connections.join(' ')}`,
  ].join('; ')
  return html.replace(
    /<head(?:\s[^>]*)?>/i,
    (head) =>
      `${head}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
  )
}
