import pico from "picocolors";

import type { CLIOptions } from "../index.js";

export const getPackageManager = ({
  options,
}: {
  options?: CLIOptions;
}): "bun" | "pnpm" | "npm" | "yarn" => {
  if (options) {
    if (options.bun) return "bun";
    if (options.pnpm) return "pnpm";
    if (options.npm) return "npm";
    if (options.yarn) return "yarn";
  }

  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.includes("bun")) return "bun";
    if (userAgent.includes("pnpm")) return "pnpm";
    if (userAgent.includes("npm")) return "npm";
    if (userAgent.includes("yarn")) return "yarn";
  }

  throw Error(pico.red("Undetectable package manager"));
};
