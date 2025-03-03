import { defineConfig } from "vocs";
import { sidebar } from "./sidebar";

export default defineConfig({
  title: "Ponder",
  sidebar,
  rootDir: ".",
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
  theme: {
    accentColor: {
      light: "#0a9fb2",
      dark: "#10c2d5",
    },
  },
});
