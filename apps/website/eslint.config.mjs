// Next.js 16 + ESLint 10 flat config.
// We don't pull `eslint-config-next` here because that package transitively
// brings in `eslint-plugin-react@7.37.x`, which still calls the
// `context.getFilename()` API that ESLint 10 removed — `pnpm lint` crashes
// at load time. Composing the plugins directly skips the broken middleman.
import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nextPlugin.configs['core-web-vitals'],
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
]

export default eslintConfig
