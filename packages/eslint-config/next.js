// Flat config for the Next.js apps (admin, marketing, partner, user). Same rule set the
// ESLint 8 preset had via @vercel/style-guide's `eslint/next`: eslint:recommended +
// @next/next recommended + turbo + prettier-off, all downgraded to warnings by only-warn.
const nextPlugin = require("@next/eslint-plugin-next")
const reactHooks = require("eslint-plugin-react-hooks")
const { base } = require("./base")

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...base,
  nextPlugin.configs.recommended,
  {
    // Source carries `eslint-disable … react-hooks/exhaustive-deps` comments, but the
    // plugin was never loaded under ESLint 8 (each one reported "Definition for rule …
    // was not found"). Registered with its rules OFF so the directives resolve and the
    // effective rule set is unchanged; turning them on is a separate decision.
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "off", "react-hooks/exhaustive-deps": "off" },
  },
]
