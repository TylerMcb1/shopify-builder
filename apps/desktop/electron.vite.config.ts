import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { contentSecurityPolicy } from './src/shared/security/baseline.ts'

function cspMetaPlugin(): Plugin {
  return {
    name: 'shopify-builder-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const policy = contentSecurityPolicy('production').replace("; frame-ancestors 'none'", '')
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
        return html.replace('<head>', `<head>\n    ${meta}`)
      },
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), cspMetaPlugin()],
  },
})
