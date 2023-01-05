/* eslint-disable prettier/prettier */

import {
  Abi,
  AbiEvent,
  AbiFunction,
  AbiParameter,
  AbiParametersToPrimitiveTypes,
  AbiParameterToPrimitiveType,
  Address,
} from "abitype";
import { Contract as EthersContract, ethers } from "ethers";

import { AbiItemName, GetOverridesForAbiStateMutability } from "./contracts";
import { CountOccurrences, IsUnknown, UnionToIntersection } from "./utils";

////////////////////////////////////////////////////////////////////////////////////////////////////
// Contract

type Keys = "address" | "interface" | "functions";
// Create new `BaseContract` and remove keys we are going to type
type BaseContract<
  TContract extends Record<keyof Pick<EthersContract, Keys>, unknown>
> = Omit<EthersContract, Keys> & TContract;

type InterfaceKeys = "events" | "functions";
// Create new `Interface` and remove keys we are going to type
type BaseInterface<
  Interface extends Record<
    keyof Pick<ethers.utils.Interface, InterfaceKeys>,
    unknown
  >
> = Omit<ethers.utils.Interface, InterfaceKeys> & Interface;

export type ReadOnlyContract<TAbi extends Abi> = Functions<TAbi> &
  BaseContract<{
    address: Address;
    interface: BaseInterface<{
      events: InterfaceEvents<TAbi>;
      functions: InterfaceFunctions<TAbi>;
    }>;
    functions: Functions<TAbi, { ReturnTypeAsArray: true }>;
  }>;

////////////////////////////////////////////////////////////////////////////////////////////////////
// Functions

export type Functions<
  TAbi extends Abi,
  Options extends {
    ReturnType?: any
    ReturnTypeAsArray?: boolean
  } = {
    ReturnTypeAsArray: false
  },
> = UnionToIntersection<
  {
    // 1. Iterate through all items in ABI
    // 2. Set non-functions to `never`
    // 3. Convert functions to TypeScript function signatures
    [K in keyof TAbi]: TAbi[K] extends infer TAbiFunction extends AbiFunction & {
      type: 'function'
      stateMutability: 'pure' | 'view'
    }
      ? {
          // If function name occurs more than once, it is overloaded. Grab full string signature as name (what ethers does).
          [K in CountOccurrences<TAbi, { name: TAbiFunction['name'] }> extends 1
            ? AbiItemName<TAbiFunction>
            : AbiItemName<TAbiFunction, true>]: (
            ...args: [
              ...args: TAbiFunction['inputs'] extends infer TInputs extends readonly AbiParameter[]
                ? AbiParametersToPrimitiveTypes<TInputs>
                : never,
              // Tack `overrides` onto end
              // TODO: TypeScript doesn't preserve tuple labels when merging
              // https://github.com/microsoft/TypeScript/issues/43020
              overrides?: GetOverridesForAbiStateMutability<
                TAbiFunction['stateMutability']
              >,
            ]
          ) => Promise<
            // Return a custom return type if specified. Otherwise, calculate return type.
            IsUnknown<Options['ReturnType']> extends true
              ? AbiFunctionReturnType<TAbiFunction> extends infer TAbiFunctionReturnType
                ? Options['ReturnTypeAsArray'] extends true
                  ? [TAbiFunctionReturnType]
                  : TAbiFunctionReturnType
                : never
              : Options['ReturnType']
          >
        }
      : never
  }[number]
>

// Get return type for function based on `AbiStateMutability`
type AbiFunctionReturnType<
  TAbiFunction extends AbiFunction & {
    type: 'function'
  },
> = ({
  payable: ethers.ContractTransaction
  nonpayable: ethers.ContractTransaction
} & {
  [_ in
    | 'pure'
    | 'view']: TAbiFunction['outputs']['length'] extends infer TLength
    ? TLength extends 0
      ? void // If there are no outputs, return `void`
      : TLength extends 1
      ? AbiParameterToPrimitiveType<TAbiFunction['outputs'][0]>
      : {
          [Output in TAbiFunction['outputs'][number] as Output extends {
            name: string
          }
            ? Output['name'] extends ''
              ? never
              : Output['name']
            : never]: AbiParameterToPrimitiveType<Output>
        } & AbiParametersToPrimitiveTypes<TAbiFunction['outputs']>
    : never
})[TAbiFunction['stateMutability']]

type InterfaceFunctions<TAbi extends Abi> = UnionToIntersection<
  {
    [K in keyof TAbi]: TAbi[K] extends infer TAbiFunction extends AbiFunction & {
      type: 'function'
    }
      ? {
          [K in AbiItemName<TAbiFunction, true>]: ethers.utils.FunctionFragment // TODO: Infer `FunctionFragment` type
        }
      : never
  }[number]
>

type InterfaceEvents<TAbi extends Abi> = UnionToIntersection<
  {
    [K in keyof TAbi]: TAbi[K] extends infer TAbiEvent extends AbiEvent
      ? {
          [K in AbiItemName<TAbiEvent, true>]: ethers.utils.EventFragment // TODO: Infer `EventFragment` type
        }
      : never
  }[number]
>
