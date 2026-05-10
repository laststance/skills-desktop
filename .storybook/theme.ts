import { create } from 'storybook/theming'

/**
 * Branded Storybook manager theme.
 *
 * The app itself is dark-first, OKLCH-driven, and developer-tool dense. The
 * manager follows that same mood: charcoal chrome, cyan-green accents, Inter
 * for UI text, and JetBrains Mono for code-like labels.
 *
 * @returns Theme object consumed by `.storybook/manager.ts`.
 * @example
 * addons.setConfig({ theme: skillsDesktopTheme })
 */
export const skillsDesktopTheme = create({
  base: 'dark',
  brandTitle: 'Skills Desktop UI',
  brandUrl: 'https://github.com/laststance/skills-desktop',
  brandTarget: '_blank',

  colorPrimary: '#22d3ee',
  colorSecondary: '#34d399',

  appBg: '#070b10',
  appContentBg: '#0b1118',
  appPreviewBg: '#080d12',
  appBorderColor: '#223044',
  appBorderRadius: 8,

  textColor: '#e7eef7',
  textInverseColor: '#061016',
  textMutedColor: '#8b9bad',

  barTextColor: '#9cadbd',
  barSelectedColor: '#67e8f9',
  barBg: '#091019',

  inputBg: '#0e1722',
  inputBorder: '#263649',
  inputTextColor: '#e7eef7',
  inputBorderRadius: 6,

  fontBase:
    '"Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontCode: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
})
