import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

const srcAlias = {
  '@': resolve(__dirname, 'src'),
}

export default defineConfig({
  main: {
    resolve: { alias: srcAlias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: ['electron'],
      },
    },
  },
  preload: {
    resolve: { alias: srcAlias },
    define: {
      __E2E_BUILD__: JSON.stringify(process.env.E2E_BUILD === '1'),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: srcAlias },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __E2E_BUILD__: JSON.stringify(process.env.E2E_BUILD === '1'),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        },
      },
    },
    plugins: [
      codeInspectorPlugin({
        bundler: 'vite',
        hotKeys: ['altKey'],
      }),
      tailwindcss(),
      react(),
    ],
  },
})
