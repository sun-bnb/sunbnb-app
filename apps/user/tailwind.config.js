/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: '#fff5e1',
          light: '#fff9ed',
          dark: '#fff0d4',
          muted: '#fff3d2',
        },
        brand: {
          cyan: '#00cef1',
          'cyan-dark': '#00b8d8',
          gold: 'rgb(142,114,49)',
          'gold-light': 'rgb(168,140,75)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      borderColor: {
        subtle: 'rgba(0,0,0,0.06)',
      },
      boxShadow: {
        'soft': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        'card': '0 2px 8px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [
  ],
}
