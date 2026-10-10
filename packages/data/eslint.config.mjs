import config from "@repo/eslint-config/react-internal.js"

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: ["scripts/**", "prisma/**"],
  },
]
