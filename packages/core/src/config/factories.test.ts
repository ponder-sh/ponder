import type { RpcLog } from "viem";
import { getEventSelector, parseAbiItem } from "viem";
import { expect, test } from "vitest";

import {
  buildFactoryCriteria,
  getAddressFromFactoryEventLog,
} from "./factories.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)"
);

test("buildFactoryCriteria throws if provided parameter not found in inputs", () => {
  expect(() =>
    buildFactoryCriteria({
      address: "0xa",
      event: llamaFactoryEventAbiItem,
      parameter: "fakeParameter",
    })
  ).toThrowError(
    "Factory event parameter 'fakeParameter' not found in factory event signature. Found: deployer, name, llamaCore, llamaExecutor, llamaPolicy, chainId."
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

const llamaInstanceCreatedLog: RpcLog = {
  address: "0xff5d4e226d9a3496eece31083a8f493edd79abeb",
  blockHash:
    "0x8d50dd73ee2640649f937f3293c24d73fb970fd6a969d1fc4bf5604cc3064833",
  blockNumber: "0x42c8f9",
  data: "0x000000000000000000000000713fb111d31c494cefd6d12f3208a0cb20e6cbfa000000000000000000000000f5e93fbb192cbcda195494828889b2efecf906670000000000000000000000005a6480483462533564634b8c81aea01cf87c6ddb0000000000000000000000000000000000000000000000000000000000aa36a7",
  logIndex: "0x20",
  removed: false,
  topics: [
    "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
    "0x0000000000000000000000000aae40c12678f810634ae552f420a46d0d951c30",
    "0x474c0f04482c93878ce2d0b37621f4b0db136c233a643836a5fcb46ad3e68da4",
  ],
  transactionHash:
    "0xc3646dabde953ecc59ab667b8f1e0fdadc99921d4722fbdc9e489d4ee13e5c5b",
  transactionIndex: "0x4",
};

test("getAddressFromFactoryEventLog throws for invalid child address location", () => {
  expect(() =>
    getAddressFromFactoryEventLog({
      criteria: {
        address: "0xa",
        eventSelector: getEventSelector(llamaFactoryEventAbiItem),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        childAddressLocation: "notATopicOrOffset123",
      },
      log: llamaInstanceCreatedLog,
    })
  ).toThrowError(
    "Invalid child address location identifier: notATopicOrOffset123"
  );
});

test("getAddressFromFactoryEventLog throws for log with not enough data", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
  });

  expect(() =>
    getAddressFromFactoryEventLog({
      criteria,
      log: { ...llamaInstanceCreatedLog, data: "0x01" },
    })
  ).toThrowError(
    "Invalid log for factory criteria: Data size too small, expected at least 32 bytes"
  );
});

test("getAddressFromFactoryEventLog throws for log with not enough topics", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "deployer",
  });

  expect(() =>
    getAddressFromFactoryEventLog({
      criteria,
      log: {
        ...llamaInstanceCreatedLog,
        topics: [
          "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
        ],
      },
    })
  ).toThrowError(
    "Invalid log for factory criteria: Not enough topic values, expected at least 1"
  );
});

test("getAddressFromFactoryEventLog gets address from indexed parameter 1", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    // Note that this is not actually a child contract address, but it's an indexed param
    // of type "address" so it should work for testing purposes.
    parameter: "deployer",
  });

  const address = getAddressFromFactoryEventLog({
    criteria: criteria,
    log: llamaInstanceCreatedLog,
  });

  expect(address).toBe("0x0aae40c12678f810634ae552f420a46d0d951c30");
});

test("getAddressFromFactoryEventLog gets address from nonindexed parameter 1", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaCore",
  });

  const address = getAddressFromFactoryEventLog({
    criteria: criteria,
    log: llamaInstanceCreatedLog,
  });

  expect(address).toBe("0x713fb111d31c494cefd6d12f3208a0cb20e6cbfa");
});

test("getAddressFromFactoryEventLog gets address from nonindexed parameter 3", () => {
  const criteria = buildFactoryCriteria({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
  });

  const address = getAddressFromFactoryEventLog({
    criteria: criteria,
    log: llamaInstanceCreatedLog,
  });

  expect(address).toBe("0x5a6480483462533564634b8c81aea01cf87c6ddb");
});
