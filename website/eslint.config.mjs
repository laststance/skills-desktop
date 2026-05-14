// Next.js 16 + ESLint 10 flat config.
// eslint-config-next ≥16 exports flat-config arrays directly, so FlatCompat
// is no longer needed (and breaks with ESLint 10's serializer).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'import/order': 'off',
    },
  },
]

export default eslintConfig
