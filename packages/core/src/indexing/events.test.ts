import { ALICE, BOB } from "@/_test/constants.js";
import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { decodeEvents } from "./events.js";
import type { Service } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("decodeEvents()", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents({ common, sourceById }, rawEvents);

  expect(events).toHaveLength(2);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE,
    amount: parseEther("1"),
  });
  expect(events[1].event.args).toMatchObject({
    from: ALICE,
    to: BOB,
    amount: parseEther("1"),
  });
});

test("decodeEvents() error", async (context) => {
  const { common, sources } = context;

  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const rawEvents = await getEventsErc20(sources);

  // remove data from log, causing an error when decoding
  rawEvents[0].log.data = "0x0";
  const events = decodeEvents({ common, sourceById }, rawEvents);

  expect(events).toHaveLength(1);

  expect(events[0].event.args).toMatchObject({
    from: ALICE,
    to: BOB,
    amount: parseEther("1"),
  });
});
