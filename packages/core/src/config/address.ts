import type { AbiEvent } from "viem";

type CommonFactoryParams<event extends AbiEvent = AbiEvent> = {
  /** Address of the factory contract that creates this contract. */
  address: `0x${string}` | readonly `0x${string}`[];
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
};

type DeprecatedFactoryEventParameter<event extends AbiEvent = AbiEvent> = {
  /**
   * Name of the factory event parameter that contains the new child contract address.
   * @deprecated Use `parameterPath` instead
   * */
  parameter: Exclude<event["inputs"][number]["name"], undefined>;
  parameterPath?: never;
};

type FactoryEventParameter = {
  /** Path to the field in factory event parameters that contains the new child contract address. */
  parameterPath: string;
  parameter?: never;
};

export type Factory<event extends AbiEvent = AbiEvent> =
  CommonFactoryParams<event> &
    (FactoryEventParameter | DeprecatedFactoryEventParameter<event>);

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
