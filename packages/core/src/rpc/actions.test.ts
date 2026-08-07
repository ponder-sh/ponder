import type { Address, Hex } from "viem";
import { expect, test, vi } from "vitest";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import { eth_getLogs } from "./actions.js";

const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const address = "0x2222222222222222222222222222222222222222" as const;

const createLog = ({
  address: logAddress = address,
  blockNumber = "0x1",
  logIndex = "0x0",
}: {
  address?: Address;
  blockNumber?: Hex;
  logIndex?: Hex;
} = {}) => ({
  blockNumber,
  logIndex,
  blockHash: hash,
  address: logAddress,
  topics: [],
  data: "0x",
  transactionHash: hash,
  transactionIndex: "0x0",
});

test("eth_getLogs chunks address arrays and merges responses", async () => {
  const addresses = Array.from(
    { length: 51 },
    (_, index) => `0x${index.toString(16).padStart(40, "0")}` as Address,
  );
  const firstLog = createLog({
    address: addresses[0],
    blockNumber: "0x2",
  });
  const secondLog = createLog({
    address: addresses[50],
    blockNumber: "0x1",
    logIndex: "0x1",
  });
  const requests: Extract<RequestParameters, { method: "eth_getLogs" }>[] = [];
  const rpcRequest = vi.fn(
    async (request: Extract<RequestParameters, { method: "eth_getLogs" }>) => {
      requests.push(request);
      const requestAddress = request.params[0].address;
      if (
        Array.isArray(requestAddress) &&
        requestAddress[0] === addresses[50]
      ) {
        return [secondLog];
      }
      return [firstLog];
    },
  );
  const rpc = { request: rpcRequest } as unknown as Rpc;
  const params: Extract<
    RequestParameters,
    { method: "eth_getLogs" }
  >["params"] = [{ address: addresses }];

  await expect(eth_getLogs(rpc, params)).resolves.toStrictEqual([
    firstLog,
    secondLog,
  ]);
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.params[0].address)).toStrictEqual([
    addresses.slice(0, 50),
    [addresses[50]],
  ]);
  expect(params[0].address).toStrictEqual(addresses);
});

test("eth_getLogs skips empty address arrays", async () => {
  const rpcRequest = vi.fn();
  const rpc = { request: rpcRequest } as unknown as Rpc;
  const params: Extract<
    RequestParameters,
    { method: "eth_getLogs" }
  >["params"] = [{ address: [] }];

  await expect(eth_getLogs(rpc, params)).resolves.toStrictEqual([]);
  expect(rpcRequest).not.toHaveBeenCalled();
});
