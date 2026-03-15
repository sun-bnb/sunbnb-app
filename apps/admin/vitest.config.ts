import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts'],
    exclude: ['app/**/*.integration.test.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['app/**/*.ts'],
      exclude: [
        'app/**/*.test.ts',
        'app/**/*.integration.test.ts',
        '**/__mocks__/**',
      ],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@repo/data/PrismaCient': path.resolve(__dirname, '__mocks__/@repo/data/PrismaCient'),
      '@repo/data/settlement': path.resolve(__dirname, '__mocks__/@repo/data/settlement'),
      '@repo/data/password-reset': path.resolve(__dirname, '__mocks__/@repo/data/password-reset'),
      '@repo/data/rate-limit': path.resolve(__dirname, '__mocks__/@repo/data/rate-limit'),
      '@repo/data/auth': path.resolve(__dirname, '__mocks__/@repo/data/auth'),
    },
  },
})
