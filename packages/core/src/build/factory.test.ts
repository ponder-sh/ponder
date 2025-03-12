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
      // @ts-expect-error
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
    parameterPath: "llamaCore",
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
    parameterPath: "llamaPolicy",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(llamaFactoryEventAbiItem),
    childAddressLocation: "offset64",
  });
});

const morphoEventAbiItem = parseAbiItem([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "event CreateMarket(bytes32 indexed id, MarketParams marketParams)",
]);

test("buildLogFactory handles Morpho CreateMarket marketParams.oracle", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: morphoEventAbiItem,
    parameterPath: "marketParams.oracle",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(morphoEventAbiItem),
    childAddressLocation: "offset64",
  });
});

const testEventAbiItem = parseAbiItem([
  "struct SomeNestedStruct { uint256 c1; address[3] c2; }",
  "struct SomeStruct { address b1; SomeNestedStruct[42] b2; }",
  "event SomeEvent(SomeStruct indexed a1, SomeStruct a2, address[] a3, (uint256[] x, address y) z, (string s, address t)[10] u, uint256 indexed v, address indexed w)",
]);

test("buildLogFactory handles fixed length arrays and tuples", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: testEventAbiItem,
    parameterPath: "a2.b2[10].c2[1]",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(testEventAbiItem),
    childAddressLocation: "offset1376",
  });
});

test("buildLogFactory handles indexed address parameters", () => {
  const criteria = buildLogFactory({
    address: "0xa",
    event: testEventAbiItem,
    parameterPath: "w",
    chainId: 1,
  });

  expect(criteria).toMatchObject({
    address: "0xa",
    eventSelector: getEventSelector(testEventAbiItem),
    childAddressLocation: "topic3",
  });
});

test("buildLogFactory throws if provided path is nested in an indexed parameter", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      // @ts-expect-error
      parameterPath: "a1.b2[10].c2[1]",
      chainId: 1,
    });
  }).toThrowError(
    "Factory event parameter is indexed, so nested path 'a1.b2[10].c2[1]' cannot be accessed.",
  );
});

test("buildLogFactory throws if provided path accesses invalid array index", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      parameterPath: "a2.b2[100].c2[1]",
      chainId: 1,
    });
  }).toThrowError(
    "Factory event parameter path contains invalid array index '100'. Array length is 42.",
  );
});

test("buildLogFactory throws if provided path accesses invalid tuple field", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      // @ts-expect-error
      parameterPath: "a2.b2[10].c3",
      chainId: 1,
    });
  }).toThrowError(
    "Factory event parameter path contains invalid tuple field. Got 'c3', expected one of ['c1', 'c2'].",
  );
});

test("buildLogFactory throws if provided path is not an address", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      // @ts-expect-error
      parameterPath: "a2.b2[10].c1",
      chainId: 1,
    });
  }).toThrowError("Factory event parameter is not an address. Got 'uint256'.");
});

test("buildLogFactory throws if provided path is not an address (indexed)", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      // @ts-expect-error
      parameterPath: "v",
      chainId: 1,
    });
  }).toThrowError("Factory event parameter is not an address. Got 'uint256'.");
});

test("buildLogFactory throws if provided path is not in a static type", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      // @ts-expect-error
      parameterPath: "a3[1]",
      chainId: 1,
    });
  }).toThrowError(
    "Factory event parameter must be a static type. Got 'address[]'.",
  );
});

test("buildLogFactory throws if provided path is in a dynamic tuple", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      parameterPath: "z.y",
      chainId: 1,
    });
  }).toThrowError("Factory event parameter must not be in a dynamic tuple.");
});

test("buildLogFactory throws if provided path is in a dynamic array", () => {
  expect(() => {
    buildLogFactory({
      address: "0xa",
      event: testEventAbiItem,
      parameterPath: "u[3].t",
      chainId: 1,
    });
  }).toThrowError("Factory event parameter must not be in a dynamic array.");
});
