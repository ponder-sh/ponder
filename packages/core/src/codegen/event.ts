import type { LogEventMetadata } from "@/config/abi";
import type { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";

export const buildEventTypes = ({
  logFilters,
  factories,
}: {
  logFilters: LogFilter[];
  factories: Factory[];
}) => {
  const allIndexingFunctions = [
    ...logFilters.map((logFilter) => {
      return Object.values(logFilter.events)
        .filter((val): val is LogEventMetadata => !!val)
        .map(({ safeName, abiItem }) => {
          const paramsType = `{${abiItem.inputs
            .map((input, index) => {
              const inputName = input.name ? input.name : `param_${index}`;
              return `${inputName}:
              AbiParameterToPrimitiveType<${JSON.stringify(input)}>`;
            })
            .join(";")}}`;

          return `["${logFilter.name}:${safeName}"]: ({
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
        .join("");
    }),
    ...factories.map((factory) => {
      return Object.values(factory.events)
        .filter((val): val is LogEventMetadata => !!val)
        .map(({ safeName, abiItem }) => {
          const paramsType = `{${abiItem.inputs
            .map((input, index) => {
              const inputName = input.name ? input.name : `param_${index}`;
              return `${inputName}:
              AbiParameterToPrimitiveType<${JSON.stringify(input)}>`;
            })
            .join(";")}}`;

          return `["${factory.name}:${safeName}"]: ({
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
        .join("");
    }),
  ];

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
