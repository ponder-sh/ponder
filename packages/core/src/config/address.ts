import type { AbiEvent, AbiParameter } from "viem";

// Add a type helper to handle nested parameters
type NestedParameter<T extends AbiParameter> = T extends {
  components: readonly AbiParameter[];
}
  ? `${Exclude<T["name"], undefined>}.${NestedParameterNames<T["components"]>}`
  : Exclude<T["name"], undefined>;

type NestedParameterNames<T extends readonly AbiParameter[]> =
  T extends readonly [
    infer First extends AbiParameter,
    ...infer Rest extends AbiParameter[],
  ]
    ? NestedParameter<First> | NestedParameterNames<Rest>
    : never;

export type Factory<event extends AbiEvent = AbiEvent> = {
  /** Address of the factory contract that creates this contract. */
  address: `0x${string}` | readonly `0x${string}`[];
  /** ABI event that announces the creation of a new instance of this contract. */
  event: event;
  /** Name of the factory event parameter that contains the new child contract address. */
  parameter: NestedParameterNames<event["inputs"]>;
};

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
