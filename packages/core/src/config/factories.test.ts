import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";

import { buildFactoryCriteria } from "./factories.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("buildFactoryCriteria throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildFactoryCriteria({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fakeParameter', expected one of ['deployer', 'name', 'llamaCore', 'llamaExecutor', 'llamaPolicy', 'chainId'].",
  );
});

test("buildFactoryCriteria handles LlamaInstanceCreated llamaCore", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset0",
  });
});

test("buildFactoryCriteria handles LlamaInstanceCreated llamaPolicy", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset64",
  });
});
