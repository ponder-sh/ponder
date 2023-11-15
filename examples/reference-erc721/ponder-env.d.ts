declare module "@/generated" {
  import type { PonderApp } from "@ponder/core";

  export const ponder: PonderApp<
    typeof import("./ponder.config.ts").default,
    typeof import("./ponder.schema.ts").default
  >;
}
