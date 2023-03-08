import { AbiParameter } from "abitype";

import type { Contract } from "@/config/contracts";

type AbiReadOrViewFunction = {
  type: "function";
  stateMutability: "pure" | "view";
  inputs: readonly AbiParameter[];
  name: string;
  outputs: readonly AbiParameter[];
};

export const buildContractTypes = (contracts: Contract[]) => {
  return contracts
    .map((contract) => {
      const abiReadOrViewFunctions = contract.abi.filter(
        (item): item is AbiReadOrViewFunction =>
          item.type === "function" &&
          (item.stateMutability === "pure" || item.stateMutability === "view")
      );

      const abiReadOrViewFunctionTypes = abiReadOrViewFunctions
        .map(({ name, inputs, outputs }) => {
          const argsType = `${inputs
            .map(
              (input, index) =>
                `${
                  input.name !== "" ? input.name : `arg_${index}`
                }: AbiParameterToPrimitiveType<${JSON.stringify(input)}>`
            )
            .join(",")}`;

          let returnType: string;
          if (outputs.length > 1) {
            returnType = `{${outputs
              .map(
                (output, index) =>
                  `${
                    output.name !== "" ? output.name : `arg_${index}`
                  }: AbiParameterToPrimitiveType<${JSON.stringify(output)}>`
              )
              .join(",")}}`;
          } else {
            returnType = `${outputs
              .map(
                (output) =>
                  `AbiParameterToPrimitiveType<${JSON.stringify(output)}>`
              )
              .join(",")}`;
          }

          return `${name}: (${argsType}) => Promise<${returnType}>`;
        })
        .join(";");

      return `export type ${contract.name} = { ${abiReadOrViewFunctionTypes} };`;
    })
    .join("\n");
};
