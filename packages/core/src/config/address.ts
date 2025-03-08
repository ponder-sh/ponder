import type {
  AbiParameter,
  SolidityArray,
  SolidityArrayWithTuple,
  SolidityTuple,
} from "abitype";
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

type ExtractValidPaths<T extends AbiParameter> = T extends {
  name: infer Name extends string;
  type: infer Type;
}
  ? Type extends SolidityTuple
    ? // Case 1: Tuple types - must access nested fields with dot notation
      // Example: "myTuple.nestedField"
      T extends {
        components: infer Components extends readonly AbiParameter[];
      }
      ? `${Name}.${ExtractValidPaths<Components[number]>}`
      : never
    : Type extends SolidityArrayWithTuple
      ? // Case 2: Array of tuples - must access index and then nested fields
        // Example: "myArray[0].nestedField"
        T extends {
          components: infer Components extends readonly AbiParameter[];
        }
        ? `${Name}[${number}].${ExtractValidPaths<Components[number]>}`
        : never
      : Type extends `address[${string}]`
        ? // Case 3: Simple arrays - must access with index
          // Example: "myArray[0]"
          `${Name}[${number}]`
        : // Case 4: Primitive types - only address type can be accessed directly
          Type extends "address"
          ? Name
          : never
  : never;

type FactoryEventParameter<event extends AbiEvent = AbiEvent> = {
  /** Path to the field in factory event parameters that contains the new child contract address. */
  parameterPath: event["inputs"][number] extends infer Input extends
    AbiParameter
    ? ExtractValidPaths<Input>
    : never;
  parameter?: never;
};

export type Factory<event extends AbiEvent = AbiEvent> =
  CommonFactoryParams<event> &
    (FactoryEventParameter<event> | DeprecatedFactoryEventParameter<event>);

export const factory = <event extends AbiEvent>(factory: Factory<event>) =>
  factory;

export type AddressConfig = {
  address?: `0x${string}` | readonly `0x${string}`[] | Factory;
};
