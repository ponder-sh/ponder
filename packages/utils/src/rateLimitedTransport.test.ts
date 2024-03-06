import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { rateLimitedTransport } from "./rateLimitedTransport.js";

const createMockTransport = () => {
  const request = vi.fn(() => Promise.resolve("hi"));
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = rateLimitedTransport(mockTransport, 1)({});

  const response = transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);

  await response;
});

test("limits request rate", async () => {
  const mock = createMockTransport();

  const transport = rateLimitedTransport(mock.mockTransport, 1)({});

  const response1 = transport.request({ method: "eth_chainId" });
  const response2 = transport.request({ method: "eth_chainId" });

  expect(mock.request).toHaveBeenCalledTimes(1);

  await response1;

  expect(mock.request).toHaveBeenCalledTimes(1);

  await response2;

  expect(mock.request).toHaveBeenCalledTimes(2);
});
