import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['app/**/*.integration.test.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['app/**/*.ts', 'lib/**/*.ts'],
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
      '@repo/data/password-reset': path.resolve(__dirname, '__mocks__/@repo/data/password-reset'),
      '@repo/data/rate-limit': path.resolve(__dirname, '__mocks__/@repo/data/rate-limit'),
      '@repo/data/reservation-status': path.resolve(__dirname, '../../packages/data/src/reservation-status'),
      '@repo/data/reservation-emails': path.resolve(__dirname, '__mocks__/@repo/data/reservation-emails'),
      '@repo/data/subscription': path.resolve(__dirname, '__mocks__/@repo/data/subscription'),
      '@repo/data/seat-label': path.resolve(__dirname, '__mocks__/@repo/data/seat-label'),
      '@repo/data/seat-label-db': path.resolve(__dirname, '__mocks__/@repo/data/seat-label-db'),
    },
  },
})
