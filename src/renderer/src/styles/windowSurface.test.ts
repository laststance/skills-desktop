import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Browser, type Page } from '@playwright/test'
import { wcagContrast } from 'culori'
import { compile } from 'tailwindcss'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { COLOR_PRESET_CHROMA, THEME_PRESETS } from '@/shared/constants'

import config from '../../../../tailwind.config'

let browser: Browser
let page: Page
const surfaces = ['background', 'card', 'muted', 'secondary']
const roles = [
  'foreground',
  'muted-foreground',
  'primary',
  'accent',
  'success',
  'destructive',
  'gstack',
  'amber-300',
  'amber-400',
  'amber-500',
  'emerald-400',
  'emerald-500',
  'sky-300',
]

beforeAll(async () => {
  // Compile the shipped stylesheet, including real Tailwind utility generation.
  const path = resolve('src/renderer/src/styles/globals.css')
  const compiler = await compile(await readFile(path, 'utf8'), {
    base: dirname(path),
    loadModule: async (id, base) => ({
      path: resolve(base, id),
      base,
      module: config,
    }),
    loadStylesheet: async (id, base) => {
      const path =
        id === 'tailwindcss'
          ? fileURLToPath(import.meta.resolve('tailwindcss/index.css'))
          : resolve(base, id)
      return {
        path,
        base: dirname(path),
        content: await readFile(path, 'utf8'),
      }
    },
  })
  const css = compiler.build([
    ...surfaces.map((surface) => `bg-${surface}`),
    ...roles.map((role) => `text-${role}`),
    'bg-primary',
    'text-primary-foreground',
    'placeholder:text-muted-foreground',
    'disabled:opacity-50',
  ])
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.setContent(
    '<main id="pane"><div id="surface"><span id="text">Readable text</span></div></main>',
  )
  await page.addStyleTag({ content: css })
}, 30_000)

afterAll(async () => {
  await browser?.close()
})

test('keeps text solid across all 54 theme modes and 101 background opacities, retaining AA at 85–100%', async () => {
  // Arrange / Act — Chromium resolves the actual CSS; only sRGB backdrop compositing happens below.
  const samples = await page.evaluate(
    ({ presets, colorChroma, surfaces, roles }) => {
      const root = document.documentElement
      const pane = document.getElementById('pane')!
      const surface = document.getElementById('surface')!
      const text = document.getElementById('text')!
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      /** Resolve browser colors to the same sRGB bytes used by screenshots.
       * @returns RGB channels and alpha in the 0–1 range.
       * @example rgba(getComputedStyle(text).color)
       */
      function rgba(color: string) {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return Array.from(
          context.getImageData(0, 0, 1, 1).data,
          (value) => value / 255,
        )
      }
      const samples: {
        theme: string
        percent: number
        surface: string
        role: string
        fg: number[]
        bg: number[]
      }[] = []
      for (const [name, preset] of Object.entries(presets)) {
        const modes = 'mode' in preset ? [preset.mode] : ['dark', 'light']
        for (const mode of modes) {
          root.className = `${mode}${preset.chroma > 0 && preset.chroma < colorChroma ? ' tone-tinted' : ''}`
          root.style.setProperty('--theme-hue', String(preset.hue))
          root.style.setProperty('--theme-chroma', String(preset.chroma))
          for (let percent = 100; percent >= 0; percent--) {
            pane.style.setProperty(
              '--window-surface-opacity',
              String(percent / 100),
            )
            for (const background of surfaces) {
              surface.className = `bg-${background}`
              const bg = rgba(getComputedStyle(surface).backgroundColor)
              for (const role of roles) {
                text.className = `text-${role}`
                samples.push({
                  theme: `${name}/${mode}`,
                  percent,
                  surface: background,
                  role,
                  fg: rgba(getComputedStyle(text).color),
                  bg,
                })
              }
            }
          }
        }
      }
      return samples
    },
    {
      presets: THEME_PRESETS,
      colorChroma: COLOR_PRESET_CHROMA,
      surfaces,
      roles,
    },
  )

  // Assert — preserve AA for semantic colors; preserve the baseline when the opaque palette is already below AA.
  expect(new Set(samples.map((sample) => sample.theme)).size).toBe(54)
  const failures: string[] = []
  const baselines = new Map<string, number>()
  const correctedColors = new Map<string, number[]>()
  for (const sample of samples) {
    const { theme, percent, surface, role, fg, bg } = sample
    expect(fg[3], `${theme}/${percent}/${role} text alpha`).toBe(1)
    expect(
      bg[3],
      `${theme}/${percent}/${surface} background alpha`,
    ).toBeCloseTo(percent / 100, 2)
    // Below 85%, keep the corrected glyph color stable rather than extrapolating past black or white.
    const colorKey = `${theme}/${surface}/${role}`
    if (percent === 85) correctedColors.set(colorKey, fg)
    if (percent < 85) {
      expect(fg, `${colorKey}/${percent} corrected color`).toEqual(
        correctedColors.get(colorKey),
      )
      continue
    }
    // Strong transparency deliberately exposes arbitrary desktop colors; AA applies to the 85–100% band.
    for (const backdrop of [0, 1]) {
      const ratio = wcagContrast(
        { mode: 'rgb', r: fg[0], g: fg[1], b: fg[2] },
        {
          mode: 'rgb',
          r: bg[0] * bg[3] + backdrop * (1 - bg[3]),
          g: bg[1] * bg[3] + backdrop * (1 - bg[3]),
          b: bg[2] * bg[3] + backdrop * (1 - bg[3]),
        },
      )
      const key = `${theme}/${surface}/${role}/${backdrop}`
      if (percent === 100) baselines.set(key, ratio)
      const threshold = ['foreground', 'muted-foreground'].includes(role)
        ? 4.5
        : Math.min(4.5, baselines.get(key)!)
      if (ratio < threshold)
        failures.push(
          `${key}/${percent}: ${ratio.toFixed(3)} < ${threshold.toFixed(3)}`,
        )
    }
  }
  expect(failures.length, failures.slice(0, 15).join('\n')).toBe(0)
}, 30_000)

test('resets both colors and alpha at opaque boundaries without changing solid action fills or inverse labels', async () => {
  // Arrange
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main class="dark" style="--window-surface-opacity:.45"><section class="opaque-surface bg-card"><span class="text-muted-foreground">Code</span><input placeholder="Search" class="placeholder:text-muted-foreground" /></section><button class="bg-primary text-primary-foreground">Action</button></main>'
  })
  // Act
  const colors = await page.evaluate(() => {
    const main = document.querySelector('main')!
    const section = document.querySelector('section')!
    const text = document.querySelector('span')!
    const button = document.querySelector('button')!
    const input = document.querySelector('input')!
    const faded = {
      bg: getComputedStyle(section).backgroundColor,
      text: getComputedStyle(text).color,
      fill: getComputedStyle(button).backgroundColor,
      inverse: getComputedStyle(button).color,
      placeholder: getComputedStyle(input, '::placeholder').color,
    }
    main.style.setProperty('--window-surface-opacity', '1')
    const opaque = {
      bg: getComputedStyle(section).backgroundColor,
      text: getComputedStyle(text).color,
      fill: getComputedStyle(button).backgroundColor,
      inverse: getComputedStyle(button).color,
      placeholder: getComputedStyle(input, '::placeholder').color,
    }
    return {
      faded,
      opaque,
      alpha: getComputedStyle(section).getPropertyValue(
        '--window-surface-opacity',
      ),
    }
  })
  // Assert
  expect(colors.faded).toEqual(colors.opaque)
  expect(colors.alpha).toBe('1')
})

test('animates only background alpha for 150ms and honors reduced motion', async () => {
  // Arrange
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main class="dark"><div id="animated" class="window-surface bg-background"><span class="text-muted-foreground">Always solid</span></div></main>'
  })
  // Act
  const frames = await page.evaluate(async () => {
    const pane = document.getElementById('animated')!
    const text = pane.querySelector('span')!
    const duration = getComputedStyle(pane).transitionDuration
    const samples: {
      alpha: number
      paneOpacity: string
      textOpacity: string
    }[] = []
    await new Promise(requestAnimationFrame)
    pane.style.setProperty('--window-surface-opacity', '.45')
    const started = performance.now()
    while (performance.now() - started < 220) {
      await new Promise(requestAnimationFrame)
      samples.push({
        alpha: Number(
          getComputedStyle(pane).getPropertyValue('--window-surface-opacity'),
        ),
        paneOpacity: getComputedStyle(pane).opacity,
        textOpacity: getComputedStyle(text).opacity,
      })
    }
    return { samples, duration }
  })
  // Assert
  expect(frames.duration).toBe('0.15s')
  expect(
    frames.samples.some((sample) => sample.alpha < 1 && sample.alpha > 0.45),
  ).toBe(true)
  expect(
    frames.samples.every(
      (sample) => sample.paneOpacity === '1' && sample.textOpacity === '1',
    ),
  ).toBe(true)
  expect(frames.samples.at(-1)?.alpha).toBe(0.45)
  // Act / Assert
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDuration = await page
    .locator('#animated')
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(reducedDuration).toBe('1e-05s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
})

test('corrects placeholders through the same text token while keeping disabled controls disabled', async () => {
  // Arrange
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main class="dark" style="--window-surface-opacity:.45"><input class="placeholder:text-muted-foreground" placeholder="Search" /><span class="text-muted-foreground">Supporting text</span><button disabled class="disabled:opacity-50">Disabled</button></main>'
  })
  // Act
  const colors = await page.evaluate(() => {
    const input = document.querySelector('input')!
    const label = document.querySelector('span')!
    const button = document.querySelector('button')!
    const translucent = {
      placeholder: getComputedStyle(input, '::placeholder').color,
      label: getComputedStyle(label).color,
      disabled: getComputedStyle(button).opacity,
    }
    document
      .querySelector('main')!
      .style.setProperty('--window-surface-opacity', '1')
    return {
      translucent,
      opaquePlaceholder: getComputedStyle(input, '::placeholder').color,
      opaqueDisabled: getComputedStyle(button).opacity,
    }
  })
  // Assert
  expect(colors.translucent.placeholder).toBe(colors.translucent.label)
  expect(colors.translucent.placeholder).not.toBe(colors.opaquePlaceholder)
  expect(colors.translucent.disabled).toBe('0.5')
  expect(colors.opaqueDisabled).toBe('0.5')
})
