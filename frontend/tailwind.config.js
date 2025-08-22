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
        sans: ["Montserrat",  'ui-sans-serif', 'system-ui'],
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
        primary: withOpacityValue("--primary"),
        "primary-foreground": withOpacityValue("--primary-foreground"),
        background: withOpacityValue("--background"),
        foreground: withOpacityValue("--foreground"),
        border: withOpacityValue("--border"),
        ring: withOpacityValue("--ring"),
      },
    },
  },
  plugins: [],
}
