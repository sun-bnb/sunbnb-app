// Flat config for internal React libraries (packages/*) and apps/mobile — bundled by their
// consumer. Same rules as the ESLint 8 preset; these workspaces lint with --max-warnings 0.
const { base, tseslint, TS_FILES } = require("./base")

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  {
    // Build/tool config files aren't in the lint tsconfig project, so the typed
    // parser can't resolve them ("file not found in project") — skip them.
    ignores: ["**/*.config.{js,cjs,mjs,ts}"],
  },
  {
    rules: {
      // Intentional infinite loops (e.g. `while (true)` with an internal return)
      // are valid; only flag constant conditions outside loops.
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
  {
    files: [...TS_FILES, "**/*.js", "**/*.jsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // TypeScript already errors on undefined identifiers, and the base rule
      // misfires on globals/types — disable it for TS (per typescript-eslint).
      "no-undef": "off",
      // The base no-unused-vars misreports parameter names in TYPE positions
      // (e.g. `onSave: (id: string) => void` in an interface). Use the
      // TS-aware rule; a leading `_` marks an intentionally-unused binding.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
]
