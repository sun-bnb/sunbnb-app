// Shared flat-config pieces (ESLint 9). Rebuilds what the ESLint 8 presets got from
// `eslint:recommended` + `prettier` + `turbo` + `only-warn`, with the same rule set: the
// ESLint 9 move (track 029 S6) is infrastructure, not a change to what gets flagged.
require("eslint-plugin-only-warn") // patches the linter: every reported problem is a warning
const js = require("@eslint/js")
const tseslint = require("typescript-eslint")
const prettier = require("eslint-config-prettier")
const turbo = require("eslint-config-turbo/flat").default
const globals = require("globals")

const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]

/** @type {import("eslint").Linter.Config[]} */
const base = [
  {
    // ESLint 8 never reported unused disable directives; ESLint 9 warns by default.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  js.configs.recommended,
  ...turbo,
  { rules: prettier.rules },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        React: "readonly",
        JSX: "readonly",
        // DOM type names ESLint 8's `env: browser` (globals@13) declared and globals@16
        // dropped. They appear only as TS types here, so no-undef on them is a false positive.
        EventListener: "readonly",
        FormDataEntryValue: "readonly",
      },
    },
  },
  {
    // Flat config lints only .js/.mjs/.cjs unless a config names other files; this is
    // what makes TypeScript sources linted at all.
    files: TS_FILES,
    languageOptions: { parser: tseslint.parser },
  },
  {
    ignores: ["**/node_modules/", "**/dist/", "**/.next/", "**/coverage/", "**/.*.js"],
  },
]

module.exports = { base, tseslint, TS_FILES }
