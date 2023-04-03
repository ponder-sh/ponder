import { AbiEvent } from "abitype";

import type { Contract } from "@/config/contracts";

export const buildEventTypes = (contracts: Contract[]) => {
  const allHandlers = contracts.map((contract) => {
    const abiEvents = contract.abi.filter(
      (item): item is AbiEvent => item.type === "event"
    );

    return abiEvents
      .map(({ name, inputs }) => {
        const paramsType = `{${inputs
          .map(
            (input) => `${input.name}:
                AbiParameterToPrimitiveType<${JSON.stringify(input)}>`
          )
          .join(";")}}`;

        return `["${contract.name}:${name}"]: ({
            event, context
            }: {
              event: {
                name: "${name}";
                params: ${paramsType};
                log: Log;
                block: Block;
                transaction: Transaction;
              };
              context: Context;
            }) => Promise<any> | any;`;
      })
      .join("");
  });

  allHandlers.unshift(
    `["setup"]: ({ context }: { context: Context; }) => Promise<any> | any;`
  );

  const final = `
    export type AppType = {
      ${allHandlers.join("")}
    }
  `;

  return final;
};
