import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { buildLogFactory } from "./factory.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

const factoryEventSimpleParamsAbiItem = parseAbiItem([
  "event CreateMarket(bytes32 indexed id ,MarketParams marketParams)",
  "struct MarketParams {address loanToken; address collateralToken; address oracle; address irm; uint256 lltv;}",
]);

const factoryEventWithDynamicChildParamsAbiItem = parseAbiItem([
  "event ChildCreated(address indexed creator, ChildInfo child, uint256 indexed timestamp)",
  "struct ChildInfo { address childAddress; string name; uint256 initialValue; uint256 creationTime; address creator; }",
]);

const factoryEventWithDynamicChildParamsAbiItem2 = parseAbiItem([
  "event ChildCreated(address creator, ChildInfo child, uint256 timestamp)",
  "struct ChildInfo { address childAddress; string name; uint256 initialValue; uint256 creationTime; address creator; }",
]);

const factoryEventWithIndexedDynamicChildParamsAbiItem = parseAbiItem([
  "event ChildCreated(address indexed creator, ChildInfo indexed child, uint256 timestamp)",
  "struct ChildInfo { address childAddress; string name; uint256 initialValue; uint256 creationTime; address creator; }",
]);

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

test("buildLogFactory throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: factoryEventSimpleParamsAbiItem,
      parameter: "marketParams.fake",
      chainId: 1,
    }),
  ).toThrowError(
    "Factory event parameter not found in factory event signature. Got 'fake', expected one of ['loanToken', 'collateralToken', 'oracle', 'irm', 'lltv'].",
  );
});

test("buildLogFactory handles CreateMarket", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: factoryEventSimpleParamsAbiItem,
    parameter: "marketParams.oracle",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(factoryEventSimpleParamsAbiItem),
    childAddressLocation: "offset64",
  });
});

test("buildLogFactory handles ChildCreated", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: factoryEventWithDynamicChildParamsAbiItem,
    parameter: "child.childAddress",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(factoryEventWithDynamicChildParamsAbiItem),
    childAddressLocation: "offset32",
  });
});

test("buildLogFactory handles ChildCreated", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: factoryEventWithDynamicChildParamsAbiItem2,
    parameter: "child.childAddress",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(factoryEventWithDynamicChildParamsAbiItem2),
    childAddressLocation: "offset96",
  });
});

test("buildLogFactory handles indexed ChildCreated", () => {
  expect(() =>
    buildLogFactory({
      address: "0xa",
      event: factoryEventWithIndexedDynamicChildParamsAbiItem,
      parameter: "child.childAddress",
      chainId: 1,
    }),
  ).toThrowError("Child parameters of indexed parameters are not accessible");
});
