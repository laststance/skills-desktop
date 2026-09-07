import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { injectRendererContentSecurityPolicy } from './injectRendererContentSecurityPolicy'

let browser: Browser
let directory: string

beforeAll(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'skills-background-csp-'))
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('renderer file-protocol content security policy', () => {
  test('production policy hashes the exact trusted inline body and contains only the required image and RPC origins', () => {
    // Arrange
    const html =
      '<html><head><script>document.documentElement.dataset.trusted = "yes";</script><script src="./bundle.js"></script></head><body></body></html>'
    // Act
    const secured = injectRendererContentSecurityPolicy(html)
    // Assert
    expect(secured).toContain(
      "script-src 'self' file: app: 'wasm-unsafe-eval' 'sha256-culqsd1OOlrrcjTBC88zI0LdOYq9oCxiIzn0AAOVtfI='",
    )
    expect(secured).toContain(
      "img-src 'self' data: file: app: https://images.unsplash.com",
    )
    expect(secured).toContain(
      "connect-src 'self' https://skills-desktop.vercel.app",
    )
    expect(secured).not.toContain("'unsafe-eval'")
    expect(secured).not.toContain('localhost')
    expect(secured.indexOf('Content-Security-Policy')).toBeLessThan(
      secured.indexOf('<script>'),
    )
  })

  test('only a development document includes its exact renderer and HMR origins', () => {
    // Arrange / Act
    const secured = injectRendererContentSecurityPolicy(
      '<html><head></head></html>',
      'http://localhost:5173/',
    )
    // Assert
    expect(secured).toContain(
      "connect-src 'self' https://skills-desktop.vercel.app http://localhost:5173 ws://localhost:5173",
    )
    expect(secured).not.toContain(
      "script-src 'self' file: app: 'unsafe-inline'",
    )
    expect(() =>
      injectRendererContentSecurityPolicy(
        '<html><head></head></html>',
        'file:///app',
      ),
    ).toThrow('HTTP or HTTPS')
  })

  test('missing document head or a competing CSP fails generation instead of silently shipping an unprotected entry', () => {
    // Arrange / Act / Assert
    expect(() => injectRendererContentSecurityPolicy('<body></body>')).toThrow(
      'must contain a head',
    )
    expect(() =>
      injectRendererContentSecurityPolicy(
        '<head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>',
      ),
    ).toThrow('already defined')
  })

  test.each(['src/renderer/index.html', 'src/renderer/settings/index.html'])(
    'file:// %s runs its hashed theme bootstrap and blocks an injected untrusted inline script',
    async (entry) => {
      // Arrange
      const context = await browser.newContext({ bypassCSP: false })
      const page = await context.newPage()
      const html = injectRendererContentSecurityPolicy(
        await fs.readFile(entry, 'utf8'),
      )
      const path = join(
        directory,
        entry.includes('settings') ? 'settings.html' : 'main.html',
      )
      await fs.writeFile(path, html)
      await page.addInitScript(() => {
        localStorage.setItem(
          'skills-desktop-state',
          JSON.stringify({
            state: { theme: { mode: 'light', hue: 210, chroma: 0 } },
          }),
        )
      })
      try {
        // Act
        await page.goto(pathToFileURL(path).href)
        await page.evaluate(() => {
          const injected = document.createElement('script')
          injected.textContent =
            'document.documentElement.dataset.injected = "executed"'
          document.head.append(injected)
        })
        // Assert
        expect(await page.locator('html').getAttribute('class')).toContain(
          'light',
        )
        expect(
          await page.locator('html').getAttribute('data-injected'),
        ).toBeNull()
        expect(
          await page
            .locator('meta[http-equiv="Content-Security-Policy"]')
            .count(),
        ).toBe(1)
      } finally {
        await context.close()
      }
    },
  )

  test('file:// policy permits the direct background and proxy while blocking unrelated network access and JavaScript eval', async () => {
    // Arrange
    const context = await browser.newContext({ bypassCSP: false })
    const page = await context.newPage()
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
      'base64',
    )
    await page.route('https://images.unsplash.com/**', async (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: image }),
    )
    await page.route('https://skills-desktop.vercel.app/**', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"available":true}',
        headers: { 'access-control-allow-origin': '*' },
      }),
    )
    const trusted = `
      new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
      document.documentElement.dataset.wasm = 'ready';
      try { new Function('return 1')(); } catch { document.documentElement.dataset.eval = 'blocked'; }
    `
    const path = join(directory, 'network.html')
    await fs.writeFile(
      path,
      injectRendererContentSecurityPolicy(
        `<html><head><script>${trusted}</script></head><body></body></html>`,
      ),
    )
    try {
      // Act
      await page.goto(pathToFileURL(path).href)
      const network = await page.evaluate(async () => {
        const background = new Image()
        background.src =
          'https://images.unsplash.com/photo-fixture?ixid=tracking'
        await background.decode()
        const allowed = await fetch(
          'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
        ).then(async (response) => response.json())
        const blocked = await fetch('https://example.com/not-allowed').then(
          () => false,
          () => true,
        )
        return { width: background.naturalWidth, allowed, blocked }
      })
      // Assert
      expect(network).toEqual({
        width: 1,
        allowed: { available: true },
        blocked: true,
      })
      expect(await page.locator('html').getAttribute('data-wasm')).toBe('ready')
      expect(await page.locator('html').getAttribute('data-eval')).toBe(
        'blocked',
      )
    } finally {
      await context.close()
    }
  })
})
