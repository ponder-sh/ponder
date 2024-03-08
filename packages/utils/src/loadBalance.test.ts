import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { loadBalance } from "./loadBalance.js";

const createMockTransport = () => {
  const request = vi.fn(() => Promise.resolve("hi"));
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = loadBalance([mockTransport])({});

  await transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);
});

test("splits requests between transports", async () => {
  const mock1 = createMockTransport();
  const mock2 = createMockTransport();

  const transport = loadBalance([mock1.mockTransport, mock2.mockTransport])({});

  await transport.request({ method: "eth_chainId" });
  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(1);
  expect(mock2.request).toHaveBeenCalledTimes(1);
});
