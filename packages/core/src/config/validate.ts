import type { Config } from "./config.js";

export const validateConfig = async ({
  config,
}: {
  config: Config;
}): Promise<void> => {
  Object.values(config.contracts).forEach((contract) => {
    if (typeof contract.network === "string") {
      // shortcut
      const network = config.networks[contract.network];
      if (!network)
        throw Error('Contract network does not match a network in "networks"');

      // Validate the address / factory data
      const resolvedFactory = "factory" in contract && contract.factory;
      const resolvedAddress = "address" in contract && contract.address;
      if (resolvedFactory && resolvedAddress)
        throw Error("Factory and address cannot both be defined");
    } else {
      Object.entries(contract.network).forEach(
        ([networkName, contractOverride]) => {
          if (!contractOverride) return;

          // Make sure network matches an element in config.networks
          const network = config.networks[networkName];
          if (!network)
            throw Error(
              'Contract network does not match a network in "networks"',
            );

          // Validate the address / factory data
          const resolvedFactory =
            ("factory" in contractOverride && contractOverride.factory) ||
            ("factory" in contract && contract.factory);
          const resolvedAddress =
            ("address" in contractOverride && contractOverride.address) ||
            ("address" in contract && contract.address);
          if (resolvedFactory && resolvedAddress)
            throw Error("Factory and address cannot both be defined");
        },
      );
    }
  });
};
