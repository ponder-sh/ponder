import { ethers } from "ethers";

import { Log } from "@/types";

// Attempt to get the event name and params for a log using an ABI.
// If the event is not found in the ABI, return null.
export const decodeLog = ({
  log,
  abiInterface,
}: {
  log: Log;
  abiInterface: ethers.utils.Interface;
}) => {
  try {
    const parsedLog = abiInterface.parseLog({
      data: log.data,
      topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
        (element): element is string => element !== undefined
      ),
    });

    const eventName = parsedLog.name;

    const params = parsedLog.eventFragment.inputs.reduce<
      Record<string, unknown>
    >((acc, input, index) => {
      let value = parsedLog.args[index];
      if (typeof value === "object" && value._isIndexed) {
        value = value.hash;
      }
      acc[input.name] = value;
      return acc;
    }, {});

    return {
      eventName,
      params,
    };
  } catch (err) {
    return null;
  }
};
