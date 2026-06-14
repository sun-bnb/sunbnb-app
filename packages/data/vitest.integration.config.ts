import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // Pins POSTGRES_URL to the throwaway sunbnb_test DB before @repo/data loads.
    setupFiles: ['./src/test/db-env.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
})
