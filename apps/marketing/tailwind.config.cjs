/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The one primary-action token (.claude/rules/ui.md). Rebrand here.
        accent: { DEFAULT: '#111827', hover: '#374151' },
        // Warm decorative note for the beach theme — never used for actions or status.
        sand: { DEFAULT: '#fff5e1', light: '#fff9ed', dark: '#fbe8c4' },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
