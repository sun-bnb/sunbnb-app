/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
    // Scan the shared restaurant UI + schematic-editor packages so their Tailwind
    // utility classes are generated in the partner build (they ship no own CSS).
    "../../packages/table-reservations-ui/src/**/*.{js,ts,jsx,tsx}",
    "../../packages/schematic-editor/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Semantic action color (the app's "primary"). Currently dark-neutral.
        // Rebrand primary buttons / active states by changing these two values.
        accent: {
          DEFAULT: '#111827', // gray-900
          hover: '#374151', // gray-700
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slide-up 0.2s ease-out',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
  ],
}
