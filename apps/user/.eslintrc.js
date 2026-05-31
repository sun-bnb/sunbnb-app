/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@repo/eslint-config/next.js"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
  },
  // Tests/mocks are excluded from tsconfig.json (so `tsc --noEmit` is actionable);
  // ESLint must skip them too — otherwise its parserOptions.project lookup fails
  // ("ESLint was configured to run on … however that TSConfig does not include this file").
  // Tests run via vitest and never ship to production, so losing ESLint on them is safe.
  ignorePatterns: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.integration.test.ts",
    "__mocks__/**",
    "app/test/**",
  ],
};
