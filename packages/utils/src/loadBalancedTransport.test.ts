import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { loadBalancedTransport } from "./loadBalancedTransport.js";

const createMockTransport = () => {
  const request = vi.fn(() => Promise.resolve("hi"));
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = loadBalancedTransport([mockTransport])({});

  await transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);
});

test("splits requests between transports", async () => {
  const mock1 = createMockTransport();
  const mock2 = createMockTransport();

  const transport = loadBalancedTransport([
    mock1.mockTransport,
    mock2.mockTransport,
  ])({});

  await transport.request({ method: "eth_chainId" });
  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(1);
  expect(mock2.request).toHaveBeenCalledTimes(1);
});
