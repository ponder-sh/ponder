import type { Source } from "@/config/sources.js";
import { dedupe } from "@ponder/common";

export type RawIndexingFunctions = {
  name: string;
  fn: (...args: any) => any;
}[];

export type IndexingFunctions = {
  [sourceName: string]: {
    [eventName: string]: (...args: any) => any;
  };
};

export function buildIndexingFunctions({
  rawIndexingFunctions,
  sources,
}: { rawIndexingFunctions: RawIndexingFunctions; sources: Source[] }) {
  const warnings: string[] = [];

  let indexingFunctionCount = 0;
  const indexingFunctions: IndexingFunctions = {};

  for (const { name: eventKey, fn } of rawIndexingFunctions) {
    const eventNameComponents = eventKey.split(":");
    const [sourceName, eventName] = eventNameComponents;
    if (eventNameComponents.length !== 2 || !sourceName || !eventName) {
      throw new Error(
        `Validation failed: Invalid event '${eventKey}', expected format '{contractName}:{eventName}'.`,
      );
    }

    indexingFunctions[sourceName] ||= {};

    if (eventName in indexingFunctions[sourceName]) {
      throw new Error(
        `Validation failed: Multiple indexing functions registered for event '${eventKey}'.`,
      );
    }

    indexingFunctions[sourceName][eventName] = fn;
    indexingFunctionCount += 1;

    const source = sources.find((s) => s.contractName === sourceName);
    if (!source) {
      // Multi-network contracts have N sources, but the hint here should not have duplicates.
      const uniqueContractNames = dedupe(sources, (s) => s.contractName);

      throw new Error(
        `Validation failed: Invalid contract name '${sourceName}'. Got '${sourceName}', expected one of [${uniqueContractNames
          .map((n) => `'${n}'`)
          .join(", ")}].`,
      );
    }

    if (
      eventName !== "setup" &&
      source.abiEvents.bySafeName[eventName] === undefined
    ) {
      throw new Error(
        `Validation failed: Event name for event '${eventKey}' not found in the contract ABI. Got '${eventName}', expected one of [${Object.keys(
          source.abiEvents.bySafeName,
        )
          .map((eventName) => `'${eventName}'`)
          .join(", ")}].`,
      );
    }
  }

  if (indexingFunctionCount === 0) {
    warnings.push("No indexing functions were registered.");
  }

  return { indexingFunctions, warnings } as const;
}

export function safeBuildIndexingFunctions({
  rawIndexingFunctions,
  sources,
}: { rawIndexingFunctions: RawIndexingFunctions; sources: Source[] }) {
  try {
    const result = buildIndexingFunctions({ rawIndexingFunctions, sources });

    return {
      status: "success",
      indexingFunctions: result.indexingFunctions,
      warnings: result.warnings,
    } as const;
  } catch (error_) {
    const error = error_ as Error;
    return { status: "error", error } as const;
  }
}
