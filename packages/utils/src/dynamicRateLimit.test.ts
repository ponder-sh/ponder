import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { dynamicRateLimit } from "./dynamicRateLimit.js";

const createMockTransport = () => {
  const request = vi.fn(() => Promise.resolve("hi"));
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = dynamicRateLimit(mockTransport, {})({});

  await transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);
});
