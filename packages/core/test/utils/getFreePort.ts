import net from "node:net";

export const getFreePort = async () => {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      if (typeof address === "string" || null)
        reject("Address null or missing port");
      const port = (address as net.AddressInfo).port;
      srv.close((err) => {
        if (err) reject(err);
        resolve(port);
      });
    });
  });
};
