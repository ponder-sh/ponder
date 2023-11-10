declare module "@/generated" {
  import type { PonderApp } from "@ponder/core";

  export const ponder: PonderApp<
    typeof import("./ponder.config.ts").config,
    typeof import("./ponder.schema.ts").schema
  >;
}
