import { AbiEvent } from "abitype";

import { LogFilter } from "@/config/logFilters";

export const buildEventTypes = (logFilters: LogFilter[]) => {
  const allHandlers = logFilters.map((logFilter) => {
    const abiEvents = logFilter.abi.filter(
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

        return `["${logFilter.name}:${name}"]: ({
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
