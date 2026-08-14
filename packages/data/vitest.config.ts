import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `scripts/` carries the scale-benchmark harness (track 020 P0). Its target
    // guard is destructive-write logic and is unit-tested like library code.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.integration.test.ts',
        'src/test/**',
      ],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
})
