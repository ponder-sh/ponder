import {
  http,
  type Chain,
  type EIP1193RequestFn,
  type PublicRpcSchema,
} from "viem";
import { mainnet } from "viem/chains";
import type { GetLogsRetryHelperParameters } from "../getLogsRetryHelper.js";

export type Params = GetLogsRetryHelperParameters["params"];
export const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const UNI = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

export const getRequest = (url: string, chain: Chain = mainnet) => {
  const request = http(url)({
    chain,
  }).request as EIP1193RequestFn<PublicRpcSchema>;

  return request;
};

export const fromBlock = 18_000_000n;
