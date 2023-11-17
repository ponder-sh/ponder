export type IndexingFunctions = {
  [sourceName: string]: {
    [eventName: string]: (...args: any) => any;
  };
};

export function validateIndexingFunctions(rawIndexingFunctions: {
  [fileName: string]: { [eventName: string]: (...args: any) => any };
}) {
  const indexingFunctions: IndexingFunctions = {};
  for (const fileFns of Object.values(rawIndexingFunctions)) {
    for (const [eventKey, fn] of Object.entries(fileFns)) {
      let sourceName: string;
      let eventName: string;

      if (eventKey === "setup") {
        const [sourceName_] = eventKey.split(":");

        sourceName = sourceName_;
        eventName = "setup";
      } else {
        const [sourceName_, eventName_] = eventKey.split(":");
        if (!sourceName_ || !eventName_)
          throw new Error(`Invalid event name: ${eventKey}`);
        sourceName = sourceName_;
        eventName = eventName_;
      }

      indexingFunctions[sourceName] ||= {};

      if (eventName in indexingFunctions[sourceName]) {
        return {
          indexingFunctions: null,
          error: new Error(
            `Two indexing functions registered for ${eventName}`,
          ),
        } as const;
      }

      indexingFunctions[sourceName][eventName] = fn;
    }
  }

  return { indexingFunctions, error: null } as const;
}
