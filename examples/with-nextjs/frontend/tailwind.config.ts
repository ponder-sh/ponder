import type { Config } from "tailwindcss";

const gray = {
  100: "#EFEFEF",
  200: "#dfdfdf",
  300: "#cfcfcf",
  500: "#8f8f8f",
  700: "#505050",
  800: "#4f4f4f",
  900: "#303030",
  1000: "#242424",
};

const textColor = {
  default: "#000",
  DEFAULT: "000",
  secondary: "#707070",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gray,
        brand: "#0E76FD",
        secondary: "#30e000",
      },
      textColor,
    },
  },
  plugins: [],
};
export default config;
