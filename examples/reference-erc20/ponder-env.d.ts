declare module "@/generated" {
  import type {
    PonderContext,
    PonderEvent,
    PonderEventNames,
    PonderApp,
    ExtractEventName,
    ExtractContractName,
  } from "@ponder/core";

  type Config = typeof import("./ponder.config.ts").default;
  type Schema = typeof import("./ponder.schema.ts").default;

  export const ponder: PonderApp<Config, Schema>;

  export type EventNames = PonderEventNames<Config>;

  export type Event<
    name extends EventNames = EventNames,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  > = PonderEvent<Config, contractName, eventName>;

  export type Context<
    name extends EventNames = EventNames,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
  > = PonderContext<Config, Schema, contractName>;

  export type IndexingFunctionArgs<name extends EventNames = EventNames> = {
    event: Event<name>;
    context: Context<name>;
  };
}
