import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { rateLimit } from "./rateLimit.js";

const createMockTransport = () => {
  const request = vi.fn(() => Promise.resolve("hi"));
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = rateLimit(mockTransport, {
    requestsPerSecond: 1,
    browser: false,
  })({});

  const response = transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);

  await response;
});

test("limits request rate", async () => {
  const mock = createMockTransport();

  const transport = rateLimit(mock.mockTransport, {
    requestsPerSecond: 1,
    browser: false,
  })({});

  const response1 = transport.request({ method: "eth_chainId" });
  const response2 = transport.request({ method: "eth_chainId" });

  expect(mock.request).toHaveBeenCalledTimes(1);

  await response1;

  expect(mock.request).toHaveBeenCalledTimes(1);

  await response2;

  expect(mock.request).toHaveBeenCalledTimes(2);
});
