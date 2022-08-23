type RpcUrlMap = Record<number, string | undefined>;

const getRpcUrlMap = () => {
  // TODO: Get RPC URL map from CLI params.
  const rpcUrlMap: RpcUrlMap = {
    137: `https://polygon-mainnet.g.alchemy.com/v2/IG7zxWD9A3dX5NNc2BiOqkIv1nqmDvHG`,
  };

  return rpcUrlMap;
};

export { getRpcUrlMap };
export type { RpcUrlMap };
