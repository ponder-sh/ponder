import type { AbiEvent } from "viem";

export type Factory<event extends AbiEvent = AbiEvent> = {
  /** Address of the factory contract that creates this contract. */
  address: `0x${string}` | readonly `0x${string}`[];
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** Name of the factory event parameter that contains the new child contract address. */
  parameter: Exclude<event["inputs"][number]["name"], undefined>;
  /** From block */
  startBlock?: number | "latest";
  endBlock?: number | "latest";
};

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
