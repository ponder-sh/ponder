import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { detect } = require("detect-package-manager");

export function getPackageManager() {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.includes("pnpm")) return "pnpm";
    if (userAgent.includes("npm")) return "npm";
    if (userAgent.includes("yarn")) return "yarn";
  }
  return detect();
}
