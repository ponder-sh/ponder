import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { buildLogFactory } from "./factory.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("buildLogFactory throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
      chainId: 1,
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fakeParameter', expected one of ['deployer', 'name', 'llamaCore', 'llamaExecutor', 'llamaPolicy', 'chainId'].",
  );
});

test("buildLogFactory handles LlamaInstanceCreated llamaCore", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset0",
  });
});

test("buildLogFactory handles LlamaInstanceCreated llamaPolicy", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset64",
  });
});
