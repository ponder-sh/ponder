import { mkdirSync } from "node:fs";
import type { Prettify } from "@/types/utils.js";
import { type PGliteOptions as Options, PGlite } from "@electric-sql/pglite";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

export function createPglite(options: PGliteOptions) {
  mkdirSync(options.dataDir, { recursive: true });
  return new PGlite(options);
}
