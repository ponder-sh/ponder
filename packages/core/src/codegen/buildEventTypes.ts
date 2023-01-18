import type { ParamType } from "@ethersproject/abi";

import { logger } from "@/common/logger";
import type { Source } from "@/sources/base";

export const buildEventTypes = (sources: Source[]) => {
  const allHandlers = sources
    .map((source) => {
      return Object.entries(source.abiInterface.events)
        .map(([signature, event]) => {
          const eventName = signature.slice(0, signature.indexOf("("));
          const paramsType = generateParamsType(event.inputs);

          return `["${source.name}:${eventName}"]: ({
            event, context
            }: {
              event: {
                name: "${eventName}";
                params: ${paramsType};
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

const valueTypeMap: { [baseType: string]: string | undefined } = {
  bool: "boolean",
  address: "string",
  string: "string",
  int: "BigNumber",
  uint: "BigNumber",
  bytes: "BytesLike",
};

const generateParamsType = (params: ParamType[]): string => {
  const childTypes = params
    .map((param) => {
      // This copies the logic ethers uses to determine if the value for a param is actually
      // a hash because it's a dynamic type. Then this assigns the `Hash` type to those params.
      // See https://github.dev/ethers-io/ethers.js/blob/c80fcddf50a9023486e9f9acb1848aba4c19f7b6/packages/abi/src.ts/interface.ts#L664-L665
      // And https://docs.soliditylang.org/en/v0.8.17/abi-spec.html?highlight=events#events:~:text=For%20all%20types,the%20same%20value
      if (
        param.indexed &&
        (param.type === "string" ||
          param.type === "bytes" ||
          param.baseType === "tuple" ||
          param.baseType === "array")
      ) {
        return `${param.name}: Hash; `;
      }

      if (param.components) {
        return `${param.name}: ${generateParamsType(param.components)}; `;
      }

      // Likely buggy for more complex event types.
      if (param.baseType === "array") {
        const elementType = param.arrayChildren.type.replace(/[0-9]+$/, "");
        return `${param.name}: ${valueTypeMap[elementType]}[]; `;
      }

      const trimmedParamBaseType = param.baseType.replace(/[0-9]+$/, "");
      const valueType = valueTypeMap[trimmedParamBaseType];
      if (valueType) {
        return `${param.name}: ${valueType}; `;
      }

      logger.warn("unhandled param:", { param });
      return `${param.name}: unknown; `;
    })
    .join("");

  return `{ ${childTypes}}`;
};
