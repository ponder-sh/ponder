declare module "@/generated" {
  import type { PonderApp } from "@ponder/core";

  export const ponder: PonderApp<
    typeof import("./ponder.config.js").default,
    typeof import("./ponder.schema.js").default
  >;
}
