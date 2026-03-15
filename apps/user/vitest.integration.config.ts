import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['app/**/*.integration.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // Point to source so vitest can transform it directly
      '@repo/data/reservation-status': path.resolve(__dirname, '../../packages/data/src/reservation-status'),
      // NOTE: @repo/data/PrismaCient intentionally NOT aliased here —
      // resolves through the workspace to the real Prisma client.
      // NOTE: @repo/data/payment intentionally NOT aliased here —
      // resolves to real payment functions for integration testing.
    },
  },
})
