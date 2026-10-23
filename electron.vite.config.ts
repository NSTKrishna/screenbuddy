import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

/**
 * Injects the Content-Security-Policy <meta> tag (SECURITY.md §3).
 * Dev relaxes two directives that Vite needs: the inline React Refresh
 * preamble and the HMR websocket. Production builds get the strict policy.
 */
function contentSecurityPolicy(): Plugin {
  const strict = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    // frame-ancestors is ignored in a <meta> policy; nothing can frame these pages anyway.
    "form-action 'none'",
  ]
  return {
    name: 'screenbuddy-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const isDev = ctx.server !== undefined
        const policy = isDev
          ? strict.map((d) =>
              d.startsWith('script-src')
                ? "script-src 'self' 'unsafe-inline'"
                : d.startsWith('connect-src')
                  ? "connect-src 'self' ws://localhost:* http://localhost:*"
                  : d,
            )
          : strict
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy.join('; ') },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Sandboxed preloads cannot require() node_modules, so bundle everything.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          assistant: resolve(__dirname, 'src/preload/assistant.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: shared },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          assistant: resolve(__dirname, 'src/renderer/assistant/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        },
      },
    },
  },
})
