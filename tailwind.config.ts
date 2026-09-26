import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      colors: {
        // Direct CSS variable references (supports both HSL and OKLCH)
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        // Semantic status color for valid/linked state. Fixed green across
        // all presets so "linked" never collapses to mid-gray in the neutral
        // (shadcn) theme. Defined in globals.css per .dark/.light block.
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
        },
        // Theme-axis accent used for the G-Stack skill-type filter dot.
        gstack: {
          DEFAULT: 'var(--gstack)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
      fontFamily: {
        // The macOS system face (SF Pro) is the UI typeface. No web font is
        // bundled, so the stack starts at `system-ui`: every Mac renders the
        // same face, whatever fonts the user has installed.
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // JetBrains Mono is not bundled, and Chromium maps bare `monospace`
        // to Courier on macOS. Menlo is the first fallback Chromium resolves;
        // same stack as `.skill-code-preview` in globals.css.
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Roboto Mono',
          'Segoe UI Mono',
          'monospace',
        ],
      },
      fontSize: {
        // Settings secondary text: descriptions, help, status, errors, and
        // nested sub-labels. Same size as the row label (14/20): Settings
        // is a reading surface; weight and color carry the hierarchy.
        'settings-description': ['0.875rem', { lineHeight: '1.25rem' }],
      },
      borderRadius: {
        '2xl': '1.25rem',
        xl: '0.75rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
}

export default config
