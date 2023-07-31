import type { AbiParameter } from "abitype";

import type { Contract } from "@/config/contracts.js";

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

      return `
      const ${contract.name}Abi = ${JSON.stringify(
        abiReadOrViewFunctions
      )} as const;

      export type ${contract.name} = ReadOnlyContract<typeof ${
        contract.name
      }Abi>;
      `;
    })
    .join("\n");
};
