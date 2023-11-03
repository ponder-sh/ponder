import type { LogEventMetadata } from "@/config/abi";
import { Source } from "@/config/sources";

export const buildEventTypes = ({ sources }: { sources: Source[] }) => {
  const allIndexingFunctions = sources.map((source) =>
    Object.values(source.events)
      .filter((val): val is LogEventMetadata => !!val)
      .map(({ safeName, abiItem }) => {
        const paramsType = `{${abiItem.inputs
          .map((input, index) => {
            const inputName = input.name ? input.name : `param_${index}`;
            return `${inputName}:
          AbiParameterToPrimitiveType<${JSON.stringify(input)}>`;
          })
          .join(";")}}`;

        return `["${source.name}:${safeName}"]: ({
        event, context
        }: {
          event: {
            name: "${abiItem.name}";
            params: ${paramsType};
            log: Log;
            block: Block;
            transaction: Transaction;
          };
          context: Context;
        }) => Promise<any> | any;`;
      })
      .join("")
  );

  allIndexingFunctions.unshift(
    `["setup"]: ({ context }: { context: Context; }) => Promise<any> | any;`
  );

  const final = `
    export type AppType = {
      ${allIndexingFunctions.join("")}
    }
  `;

  return final;
};
