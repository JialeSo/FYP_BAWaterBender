/** @type {import('tailwindcss').Config} */

// Helper to use CSS variables with opacity
function withOpacityValue(variable) {
  return ({ opacityValue }) => {
    if (opacityValue === undefined) {
      return `rgb(var(${variable}))`
    }
    return `rgb(var(${variable}) / ${opacityValue})`
  }
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    "text-primary",
    "bg-primary",
    "border-primary",
    "text-primary-foreground",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Montserrat", "Poppins", "ui-sans-serif", "system-ui"],
      },
      keyframes: {
        "slide-up": {
          "0%": { transform: "translateY(30px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-15px)" },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.6s ease-out forwards",
        marquee: "marquee 25s linear infinite",
        float: "float 3s ease-in-out infinite",
      },
      colors: {
        // ✅ semantic tokens from CSS vars
        primary: withOpacityValue("--primary"),
        "primary-foreground": withOpacityValue("--primary-foreground"),
        background: withOpacityValue("--background"),
        foreground: withOpacityValue("--foreground"),
        border: withOpacityValue("--border"),
        ring: withOpacityValue("--ring"),

        // ✅ extended palettes
        primaryPalette: { 
          50: '#fcfdff',
          100: '#f4f6fe',
          200: '#e6ebfd',
          300: '#d3dcfc',
          400: '#bac8fa',
          500: '#9cb0f8',
          600: '#7994f5',
          700: '#5073f2',
          800: '#0c2c9f',
          900: '#06154b',
          950: '#040d2f',
        },
        secondary: { 
          50: '#fdfdff',
          100: '#f9f9ff',
          200: '#f1f1ff',
          300: '#e6e5ff',
          400: '#d8d7ff',
          500: '#c8c6ff',
          600: '#b4b1ff',
          700: '#9c99ff',
          800: '#0700d2',
          900: '#03005b',
          950: '#020033',
        },
        white: { 
          50: '#ffffff',
          100: '#fefefe',
          200: '#fcfcfc',
          300: '#fafafa',
          400: '#f7f7f7',
          500: '#f3f3f4',
          600: '#efeff0',
          700: '#eaeaec',
          800: '#71717c',
          900: '#2e2e33',
          950: '#18181b',
        },
        dark: { 
          50: '#fbfbfc',
          100: '#f0f0f2',
          200: '#dddde1',
          300: '#c2c2c9',
          400: '#a0a0ab',
          500: '#767685',
          600: '#4b4b54',
          700: '#18181b',
          800: '#0b0b0c',
          900: '#030303',
          950: '#000000',
        },
      },
    },
  },
  darkMode: "class",
  plugins: [],
}
