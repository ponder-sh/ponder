import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { buildChildAddressCriteria } from "./factories.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("buildChildAddressCriteria throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildChildAddressCriteria({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fakeParameter', expected one of ['deployer', 'name', 'llamaCore', 'llamaExecutor', 'llamaPolicy', 'chainId'].",
  );
});

test("buildChildAddressCriteria handles LlamaInstanceCreated llamaCore", () => {
  const criteria = buildChildAddressCriteria({
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

test("buildChildAddressCriteria handles LlamaInstanceCreated llamaPolicy", () => {
  const criteria = buildChildAddressCriteria({
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
