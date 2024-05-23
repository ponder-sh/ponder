import { RpcError, type Transport } from "viem";
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

  const transport = dynamicRateLimit(mockTransport)({});

  await transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(1);
});

test("adjusts request frequency", async () => {
  const { request, mockTransport } = createMockTransport();

  const transport = dynamicRateLimit(mockTransport)({});

  for (let i = 0; i < 50; i++) {
    transport.request({ method: "eth_chainId" });
  }
  expect(request).toHaveBeenCalledTimes(20);

  await new Promise((res) => setTimeout(res, 1_000));

  await transport.request({ method: "eth_chainId" });

  expect(request).toHaveBeenCalledTimes(51);
});

test("adjusts request frequency w/ 429", async () => {
  const request = vi.fn(() =>
    Promise.reject(
      new RpcError(new Error(), { code: 429, shortMessage: "rate limit" }),
    ),
  );
  const mockTransport = (() => ({
    request,
  })) as unknown as Transport;

  const transport = dynamicRateLimit(mockTransport)({});

  for (let i = 0; i < 50; i++) {
    transport.request({ method: "eth_chainId" }).catch((err) => err);
  }

  await new Promise((res) => setTimeout(res, 1_000));

  const error = await transport
    .request({ method: "eth_chainId" })
    .catch((err) => err);

  expect(error).instanceOf(RpcError);

  expect(request).toHaveBeenCalledTimes(51);
});
