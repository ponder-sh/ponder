/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx,md,mdx}",
    "./components/**/*.{ts,tsx,md,mdx}",
    "./app/**/*.{ts,tsx,md,mdx}",
    "./src/**/*.{ts,tsx,md,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        ponder: "#2AA3B1",
        "ponder-50": "#39DFF2",
        "ponder-100": "#35CDDF",
        "ponder-200": "#30BCCC",
        "ponder-300": "#2CAAB9",
        "ponder-400": "#2799A6",
        "ponder-500": "#238793",
        "ponder-600": "#1E7580",
        "ponder-700": "#1A646C",
        "ponder-800": "#155259",
        "ponder-900": "#114146",
        "ponder-950": "#0C2F33",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
