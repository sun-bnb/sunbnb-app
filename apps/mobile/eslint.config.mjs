import config from "@repo/eslint-config/react-internal.js"

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: [".expo/**", "dist/**", "assets/**", "expo-env.d.ts"],
  },
]
