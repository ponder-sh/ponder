import { type Transport, custom } from "viem";

export const rateLimitedRpc = (
  _transport: Transport,
  requestsPerSecond = 5,
): Transport => {
  const interval = 1000 / requestsPerSecond;
  let lastRequestTime = 0;

  const allowRequest = () => {
    const now = performance.now();
    if (now - lastRequestTime > interval) {
      lastRequestTime = now;
      return true;
    }
    return false;
  };

  return ({ chain }) => {
    const transport = _transport({ chain });
    const c = custom({
      async request({ method, params }) {
        return new Promise((resolve) => {
          const checkRequest = setInterval(async () => {
            if (allowRequest()) {
              clearInterval(checkRequest);

              resolve(await transport.request({ method, params }));
            }
          }, interval);
        });
      },
    });
    return c({ chain });
  };
};
