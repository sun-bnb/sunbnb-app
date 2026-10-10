import config from "@repo/eslint-config/next.js"

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts", "__mocks__/**"],
  },
]
