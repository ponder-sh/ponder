import { AbiEvent } from "abitype";

import type { Contract } from "@/config/contracts";

export const buildEventTypes = (contracts: Contract[]) => {
  const allHandlers = contracts
    .map((contract) => {
      const abiEvents = contract.abi.filter(
        (item): item is AbiEvent => item.type === "event"
      );

      return abiEvents
        .map(({ name, inputs }) => {
          // const eventName = signature.slice(0, signature.indexOf("("));
          // const paramsType = generateParamsType(event.inputs);

          return `["${contract.name}:${name}"]: ({
            event, context
            }: {
              event: {
                name: "${name}";
                params: AbiParametersToPrimitiveTypes<${JSON.stringify(
                  inputs
                )}>;
                log: Log;
                block: Block;
                transaction: Transaction;
              };
              context: Context;
            }) => Promise<any> | any;`;
        })
        .join("");
    })
    .join("");

  const final = `
    export type AppType = {
      ${allHandlers}
    }
  `;

  return final;
};
