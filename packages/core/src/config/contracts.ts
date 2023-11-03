// import type { Abi, Address } from "abitype";

// import type { Options } from "@/config/options";
// import type { ResolvedConfig } from "@/config/types";
// import { toLowerCase } from "@/utils/lowercase";

// import { buildAbi } from "./abi";
// import type { Network } from "./networks";

// export type Contract = {
//   name: string;
//   address: Address;
//   network: Network;
//   abi: Abi;
// };

// export function buildContracts({
//   config,
//   options,
//   networks,
// }: {
//   config: ResolvedConfig;
//   options: Options;
//   networks: Network[];
// }) {
//   const contracts = config.contracts ?? [];

//   return contracts
//     .filter(
//       (
//         contract
//       ): contract is (typeof contracts)[number] & { address: Address } =>
//         !!contract.address
//     )
//     .map((contract) => {
//       const address = toLowerCase(contract.address);

//       const { abi } = buildAbi({
//         abiConfig: contract.abi,
//         configFilePath: options.configFile,
//       });

//       // Get the contract network/provider.
//       const network = networks.find((n) => n.name === contract.network);
//       if (!network) {
//         throw new Error(
//           `Network [${contract.network}] not found for contract: ${contract.name}`
//         );
//       }

//       return { name: contract.name, address, network, abi } satisfies Contract;
//     });
// }
