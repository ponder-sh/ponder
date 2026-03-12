import type { LogFactory } from "@/internal/types.js";
import type { AbiEvent, AbiParameter } from "viem";

// Note: Currently limit the depth to 1 level.
type ParameterNames<T extends AbiParameter> = T extends {
  components: readonly AbiParameter[];
}
  ? T["components"][number] extends {
      components: readonly AbiParameter[];
    }
    ? never
    : `${T["name"]}.${T["components"][number]["name"]}`
  : T["name"];

export type Factory<event extends AbiEvent = AbiEvent> = {
  /** Address of the factory contract that creates this contract. */
  address?: `0x${string}` | readonly `0x${string}`[];
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** From block */
  startBlock?: number | "latest";
  /** To block */
  endBlock?: number | "latest";
} & (
  | {
      /** Name of the factory event parameter that contains the new child contract address. */
      parameter: Exclude<ParameterNames<event["inputs"][number]>, undefined>;
      location?: never;
    }
  | {
      parameter?: never;
      /**
       * Low-level alternative to `parameter`. Specifies the exact location
       * (e.g. topic or offset) of the child contract address in the factory
       * event. Most users should prefer `parameter` instead.
       */
      location: LogFactory["childAddressLocation"];
    }
);

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
