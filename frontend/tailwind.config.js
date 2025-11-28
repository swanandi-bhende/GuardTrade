/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-lightest': '#EAF0CE',
        'brand-light': '#C0C5C1',
        'brand-gray-medium': '#7D8491',
        'brand-dark': '#574B60',
        'brand-darkest': '#3F334D',
        'primary': '#AB8476',
        'secondary': '#3D314A',
        'background': '#1A1423',
        'surface': '#2C2337'
      },
      fontFamily: {
        'sans': ['Inter', 'sans-serif'],
        'serif': ['DM Serif Text', 'serif'],
      },
    },
  },
  plugins: [],
}