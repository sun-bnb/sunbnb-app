import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['app/**/*.integration.test.ts'],
    // Pins POSTGRES_URL to the throwaway sunbnb_test DB before @repo/data loads.
    setupFiles: ['./app/test/db-env.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@repo/data/reservation-status': path.resolve(__dirname, '../../packages/data/src/reservation-status'),
      // NOTE: @repo/data/PrismaCient intentionally NOT aliased here —
      // resolves through the workspace to the real Prisma client.
    },
  },
})
