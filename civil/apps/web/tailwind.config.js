const defaultTheme = require('tailwindcss/defaultTheme')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        brand: {
          50: '#fff1f0',
          100: '#ffe2df',
          200: '#ffb9b2',
          300: '#ff8a80',
          400: '#ff5c4d',
          500: '#d52b1e',
          600: '#b91f14',
          700: '#99170f',
          800: '#7a110a',
          900: '#5c0b07',
        },
        slate: {
          950: '#020617',
        },
      },
      boxShadow: {
        panel: '0 18px 45px rgba(15, 23, 42, 0.08)',
        subtle: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
      },
      borderRadius: {
        panel: '20px',
      },
      backgroundImage: {
        'cc-grid': 'radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.2) 1px, transparent 0)',
      },
    },
  },
  plugins: [],
}
