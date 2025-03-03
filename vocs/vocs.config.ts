import { defineConfig } from "vocs";
import { sidebar } from "./sidebar";

export default defineConfig({
  title: "Ponder",
  rootDir: ".",
  sidebar,
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
});
