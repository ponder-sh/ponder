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
      fromBlock: undefined,
      toBlock: undefined,
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
    fromBlock: undefined,
    toBlock: undefined,
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
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset64",
  });
});

const morphoFactoryEvent = parseAbiItem([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv;}",
  "event CreateMarket(bytes32 indexed id, MarketParams marketParams)",
]);

test("buildLogFactory handles Morpho CreateMarket struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: morphoFactoryEvent,
    parameter: "marketParams.oracle",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector:
      "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac",
    childAddressLocation: "offset64",
  });
});

const zoraFactoryEvent = parseAbiItem([
  "struct PoolKey { address currency0; address currency1; uint24 fee;int24 tickSpacing; address hooks; }",
  "event CoinCreatedV4(address indexed caller,address indexed payoutRecipient,address indexed platformReferrer,address currency,string uri,string name,string symbol,address coin,PoolKey poolKey,bytes32 poolKeyHash,string version)",
]);

test("buildLogFactory handles Morpho CreateMarket struct parameter", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: zoraFactoryEvent,
    parameter: "poolKey.hooks",
    chainId: 1,
    fromBlock: undefined,
    toBlock: undefined,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector:
      "0x2de436107c2096e039c98bbcc3c5a2560583738ce15c234557eecb4d3221aa81",
    childAddressLocation: "offset288",
  });
});
