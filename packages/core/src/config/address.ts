import type { AbiEvent } from "abitype";

// TODO: support unnamed parameter
export type GetAddress<contract> = contract extends {
  factory: unknown;
}
  ? // 1. Contract contains a factory
    contract extends {
      factory: {
        event: infer event extends AbiEvent;
      };
    }
    ? // 1.a Contract has a valid factory event
      {
        factory: {
          /** Address of the factory contract that creates this contract. */
          address: `0x${string}`;
          /** ABI event that announces the creation of a new instance of this contract. */
          event: AbiEvent;
          /** Name of the factory event parameter that contains the new child contract address. */
          parameter: Exclude<event["inputs"][number]["name"], undefined>;
        };
      }
    : // 1.b Contract has an invalid factory event
      {
        factory: {
          /** Address of the factory contract that creates this contract. */
          address: `0x${string}`;
          /** ABI event that announces the creation of a new instance of this contract. */
          event: AbiEvent;
          /** Name of the factory event parameter that contains the new child contract address. */
          parameter: string;
        };
      }
  : // 2. Contract has an address
    contract extends { address: unknown }
    ? { address: `0x${string}` | readonly `0x${string}`[] }
    : contract;
