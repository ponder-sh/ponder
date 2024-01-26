import { parseAbi } from "viem";

export const abi = parseAbi([
  "event Event1(bytes32 arg)",
  "event Event2(bytes32 arg)",
  "event Event3(bytes32 arg)",
]);
