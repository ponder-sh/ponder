import type { EventFragment, ParamType } from "@ethersproject/abi";
import { Contract } from "ethers";

import { logger } from "@/common/logger";
import type { Source } from "@/sources/base";

export const buildHandlerTypes = (sources: Source[]) => {
  const handlerTypes = sources
    .map((source) => {
      const contract = new Contract(source.address, source.abiInterface);

      const eventHandlers = Object.entries(contract.interface.events).map(
        ([eventSignature, event]) =>
          generateEventHandlerType(eventSignature, event)
      );

      const eventHandlersTypeString = eventHandlers
        .map((handler) => handler.typeString)
        .join("");

      const contractHandlersTypeString = `
      export type ${source.name}Handlers = { ${eventHandlers
        .map(({ name }) => `${name}?: ${name}Handler`)
        .join(",")}}
      `;

      const final = eventHandlersTypeString + contractHandlersTypeString;

      return final;
    })
    .join("\n");

  return handlerTypes;
};

// HELPERS

const generateEventHandlerType = (
  eventSignature: string,
  event: EventFragment
) => {
  const eventName = eventSignature.slice(0, eventSignature.indexOf("("));

  const parameterType = generateParamsType(event.inputs);

  const eventHandlerTypes = `
  export interface ${eventName}Event extends EventLog {
    name: "${eventName}";
    params: ${parameterType};
    block: Block;
    transaction: Transaction;
  }
  export type ${eventName}Handler = (event: ${eventName}Event, context: Context) => void;
  `;

  return {
    name: eventName,
    typeString: eventHandlerTypes,
  };
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
