const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/*
 * This is a custom ESLint configuration for use with
 * internal (bundled by their consumer) libraries
 * that utilize React.
 */

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["eslint:recommended", "prettier", "turbo"],
  plugins: ["only-warn", "@typescript-eslint"],
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    browser: true,
    node: true,
  },
  settings: {
    "import/resolver": {
      typescript: {
        project,
      },
    },
  },
  ignorePatterns: [
    // Ignore dotfiles
    ".*.js",
    // Build/tool config files aren't in the lint tsconfig project, so the typed
    // parser can't resolve them ("file not found in project") — skip them.
    "*.config.js",
    "*.config.cjs",
    "*.config.mjs",
    "*.config.ts",
    "node_modules/",
    "dist/",
    "coverage/",
  ],
  rules: {
    // Intentional infinite loops (e.g. `while (true)` with an internal return)
    // are valid; only flag constant conditions outside loops.
    "no-constant-condition": ["warn", { checkLoops: false }],
  },
  overrides: [
    {
      files: ["*.js?(x)", "*.ts?(x)"],
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
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            ignoreRestSiblings: true,
          },
        ],
      },
    },
  ],
};
