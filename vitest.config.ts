import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/{main,shared}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
