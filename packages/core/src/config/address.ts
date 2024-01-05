import type { AbiEvent } from "abitype";

type FactoryConfig<
  event extends AbiEvent | unknown = unknown,
  parameter extends event extends AbiEvent
    ? event["inputs"][number]["name"]
    : unknown = event extends AbiEvent
    ? event["inputs"][number]["name"]
    : unknown,
> = {
  /** Address of the factory contract that creates this contract. */
  address: `0x${string}`;
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** Name of the factory event parameter that contains the new child contract address. */
  parameter: parameter;
};

export type AddressConfig =
  | {
      address: `0x${string}` | readonly `0x${string}`[];
      factory?: never;
    }
  | {
      address?: never;
      /** Factory contract configuration. */
      factory: "factory";
    }
  | {
      address?: never;
      factory?: never;
    };
