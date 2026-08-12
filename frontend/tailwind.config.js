/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dbx: {
          red: '#FF3621',
          dark: '#1B1B1B',
        },
      },
    },
  },
  plugins: [],
}
