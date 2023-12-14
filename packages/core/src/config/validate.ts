import type { Config } from "./config.js";

export const validateConfig = async ({
  config,
}: {
  config: Config;
}): Promise<void> => {
  Object.entries(config.contracts).forEach(([contractName, contract]) => {
    if (typeof contract.network === "string") {
      // shortcut
      const network = config.networks[contract.network];
      if (!network)
        throw Error(
          `Validation failed: Contract network "${contract.network}" does not match a network in "networks" (contract=${contractName})`,
        );

      // Validate the address / factory data
      const resolvedFactory = "factory" in contract && contract.factory;
      const resolvedAddress = "address" in contract && contract.address;
      if (resolvedFactory && resolvedAddress)
        throw Error(
          `Validation failed: Contract "factory" and "address" cannot both be defined (contract=${contractName})`,
        );
    } else {
      Object.entries(contract.network).forEach(
        ([networkName, contractOverride]) => {
          if (!contractOverride) return;

          // Make sure network matches an element in config.networks
          const network = config.networks[networkName];
          if (!network)
            throw Error(
              `Validation failed: Contract network "${networkName}" does not match a network in "networks" (contract=${contractName})`,
            );

          // Validate the address / factory data
          const resolvedFactory =
            ("factory" in contractOverride && contractOverride.factory) ||
            ("factory" in contract && contract.factory);
          const resolvedAddress =
            ("address" in contractOverride && contractOverride.address) ||
            ("address" in contract && contract.address);
          if (resolvedFactory && resolvedAddress)
            throw Error(
              `Validation failed: Contract "factory" and "address" cannot both be defined (contract=${contractName}, network=${networkName})`,
            );
        },
      );
    }
  });
};
