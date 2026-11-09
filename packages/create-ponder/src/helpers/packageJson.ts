import { readFileSync } from "node:fs";

/**
 * This package's `package.json`. Read at runtime because it lives outside `src`,
 * so it can't be imported without breaking the `src` -> `dist` layout.
 */
export const packageJson: { name: string; version: string } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);
