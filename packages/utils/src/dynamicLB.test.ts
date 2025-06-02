import type { Transport } from "viem";
import { expect, test, vi } from "vitest";
import { dynamicLB } from "./dynamicLB.js";

const createMockTransport = (latency: number) => {
  const request = vi.fn(
    () => new Promise((resolve) => setTimeout(resolve, latency)),
  );
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  return { request, mockTransport };
};

test("sends a request", async () => {
  const mock1 = createMockTransport(0);
  const mock2 = createMockTransport(0);

  const transport = dynamicLB([mock1.mockTransport, mock2.mockTransport])({});

  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(1);

  await transport.request({ method: "eth_chainId" });

  expect(mock2.request).toHaveBeenCalledTimes(1);
});

test("splits requests between transports", async () => {
  const mock1 = createMockTransport(0);
  const mock2 = createMockTransport(0);

  const transport = dynamicLB([mock1.mockTransport, mock2.mockTransport])({});

  await Promise.all(
    Array.from({ length: 100 }).map(async () =>
      transport.request({ method: "eth_cahinId" }),
    ),
  );

  expect(mock1.request).toHaveBeenCalledTimes(50);

  expect(mock2.request).toHaveBeenCalledTimes(50);
});

test("sends requests to the fastest transport", async () => {
  const mock1 = createMockTransport(10);
  const mock2 = createMockTransport(5);

  const transport = dynamicLB([mock1.mockTransport, mock2.mockTransport])({});

  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(1);

  await transport.request({ method: "eth_chainId" });

  expect(mock2.request).toHaveBeenCalledTimes(1);

  await transport.request({ method: "eth_chainId" });
  await transport.request({ method: "eth_chainId" });
  await transport.request({ method: "eth_chainId" });

  expect(mock2.request).toHaveBeenCalledTimes(4);
});

test("limits request rate and routes to available transport", async () => {
  const mock1 = createMockTransport(10);
  const mock2 = createMockTransport(5);

  const transport = dynamicLB([mock1.mockTransport, mock2.mockTransport])({});

  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(1);

  await transport.request({ method: "eth_chainId" });

  expect(mock2.request).toHaveBeenCalledTimes(1);

  await Promise.all(
    Array.from({ length: 50 }).map(async () =>
      transport.request({ method: "eth_chainId" }),
    ),
  );

  expect(mock2.request).toHaveBeenCalledTimes(51);

  await transport.request({ method: "eth_chainId" });

  expect(mock1.request).toHaveBeenCalledTimes(2);
});
