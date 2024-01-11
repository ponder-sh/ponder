declare module "@/generated" {
  import type {
    PonderApp,
    PonderEventNames,
    PonderEvent,
    PonderContext,
  } from "@ponder/core";

  type Config = typeof import("./ponder.config.ts").default;
  type Schema = typeof import("./ponder.schema.ts").default;

  export const ponder: PonderApp<Config, Schema>;

  export type Context = ExtractContext<Config, Schema>;

  export type Names = PonderEventNames<Config>;

  export type ExtractEvent<
    name extends Names,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  > = PonderEvent<Config, contractName, eventName>;

  export type ExtractContext<
    name extends Names,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
  > = PonderContext<Config, Schema, contractName>;
}
