import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Common } from "@/internal/common.js";

export const ponderEnv = `/// <reference types="ponder/virtual" />

declare module "ponder:internal" {
  const config: typeof import("./ponder.config.ts");
  const schema: typeof import("./ponder.schema.ts");
}

declare module "ponder:schema" {
  export * from "./ponder.schema.ts";
}

// This file enables type checking and editor autocomplete for this Ponder project.
// After upgrading, you may find that changes have been made to this file.
// If this happens, please commit the changes. Do not manually edit this file.
// See https://ponder.sh/docs/requirements#typescript for more information.
`;

export function runCodegen({ common }: { common: Common }) {
  writeFileSync(
    path.join(common.options.rootDir, "ponder-env.d.ts"),
    ponderEnv,
    "utf8",
  );

  common.logger.debug({
    service: "codegen",
    msg: "Wrote new file at ponder-env.d.ts",
  });
}
