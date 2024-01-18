import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { wait } from "@/helpers/wait.js";
import type { SerializableConfig, SerializableContract } from "@/index.js";
import type { Abi } from "abitype";
import pico from "picocolors";
import prettier from "prettier";
import type { Chain } from "viem";
import * as chains from "viem/chains";

type ChainExplorer = {
  name: string;
  id: number;
  explorer: NonNullable<Chain["blockExplorers"]>[string];
};

const chainExplorerByHostname: Record<string, ChainExplorer> = {};

for (const [name, chain] of Object.entries(chains)) {
  for (const explorer of Object.values((chain as Chain).blockExplorers ?? {})) {
    const hostname = new URL(explorer.url).hostname;
    chainExplorerByHostname[hostname] = {
      name,
      id: (chain as Chain).id,
      explorer,
    };
  }
}

export const fromEtherscan = async ({
  rootDir,
  etherscanLink,
  etherscanApiKey,
}: {
  rootDir: string;
  etherscanLink: string;
  etherscanApiKey?: string;
}) => {
  const warnings: string[] = [];

  const apiKey = etherscanApiKey || process.env.ETHERSCAN_API_KEY;
  const explorerUrl = new URL(etherscanLink);

  const chainExplorer = chainExplorerByHostname[explorerUrl.hostname];
  if (!chainExplorer)
    throw new Error(
      `Block explorer (${explorerUrl.hostname}) is not present in viem/chains.`,
    );

  const name = chainExplorer.name;
  const chainId = chainExplorer.id;
  const apiUrl = chainExplorer.explorer.apiUrl;
  if (!apiUrl)
    throw new Error(
      `${pico.red("✗")} Block explorer (${
        explorerUrl.hostname
      }) does not have a API URL registered in viem/chains.`,
    );

  const pathComponents = explorerUrl.pathname.slice(1).split("/");
  const contractAddress = pathComponents[1];

  if (
    pathComponents[0] !== "address" ||
    !(typeof contractAddress === "string") ||
    !contractAddress.startsWith("0x")
  ) {
    throw new Error(
      `${pico.red("✗")} Invalid block explorer URL (${
        explorerUrl.href
      }). Expected path "/address/<contract-address>".`,
    );
  }

  let abiResult: { abi: string; contractName: string } | undefined = undefined;
  try {
    abiResult = await getContractAbiAndName(contractAddress, apiUrl, apiKey);
  } catch (e) {
    const error = e as Error;
    throw new Error(
      `${pico.red("✗")} Failed to fetch contract ABI from block explorer API: ${
        error.message
      }`,
    );
  }

  if (typeof abiResult.abi !== "string")
    throw new Error(
      `${pico.red(
        "✗",
      )} Invalid ABI returned from block explorer API. Is the contract verified?`,
    );
  const baseAbi = JSON.parse(abiResult.abi) as Abi;
  let contractName = abiResult.contractName;

  const abis: { abi: Abi; contractName: string }[] = [
    { abi: baseAbi, contractName },
  ];

  let blockNumber: number | undefined = undefined;
  try {
    if (!apiKey) await wait(5000);
    const txHash = await getContractCreationTxn(
      contractAddress,
      apiUrl,
      apiKey,
    );

    if (!apiKey) await wait(5000);
    const contractCreationBlockNumber = await getTxBlockNumber(
      txHash,
      apiUrl,
      apiKey,
    );

    blockNumber = contractCreationBlockNumber;
  } catch (error) {
    // Do nothing, blockNumber won't be set.
  }

  // If the contract is an EIP-1967 proxy, get the implementation contract ABIs.
  if (
    baseAbi.find(
      (item) =>
        item.type === "event" &&
        item.name === "Upgraded" &&
        item.inputs[0].name === "implementation",
    )
  ) {
    if (!apiKey) await wait(5000);
    const { implAddresses } = await getProxyImplementationAddresses({
      contractAddress,
      apiUrl,
      fromBlock: blockNumber,
      apiKey,
    });

    for (const implAddress of implAddresses) {
      if (!apiKey) await wait(5000);
      const { abi, contractName: implContractName } =
        await getContractAbiAndName(implAddress, apiUrl, apiKey);

      if (typeof abi !== "string") {
        warnings.push(
          `Unable to fetch ABI for implementation contract ${implAddress}. Please see the proxy contract documentation for more details: https://ponder.sh/docs/guides/add-contracts#multiple-abis`,
        );
        continue;
      }

      // Update the top-level contract name to the impl contract name.
      contractName = implContractName;
      abis.push({
        abi: JSON.parse(abi) as Abi,
        contractName: `${contractName}_${implAddress.slice(0, 6)}`,
      });
    }
  }

  mkdirSync(path.join(rootDir, "abis"), { recursive: true });
  mkdirSync(path.join(rootDir, "src"), { recursive: true });

  // Write ABI files.
  let abiConfig: SerializableContract["abi"] | undefined;

  for (const { abi, contractName } of abis) {
    const abiRelativePath = `./abis/${contractName}Abi.ts`;
    const abiAbsolutePath = path.join(
      path.resolve(".", rootDir),
      abiRelativePath,
    );
    writeFileSync(
      abiAbsolutePath,
      await prettier.format(
        `export const ${contractName}Abi = ${JSON.stringify(abi)} as const`,
        { parser: "typescript" },
      ),
    );

    if (abis.length === 1) {
      abiConfig = {
        abi,
        dir: abiRelativePath,
        name: `${contractName}Abi`,
      };
    } else {
      if (abiConfig === undefined) {
        abiConfig = [];
      }
      (abiConfig as unknown[]).push({
        abi,
        name: `${contractName}Abi`,
        dir: abiRelativePath,
      });
    }
  }

  // Build and return the partial ponder config.
  const config: SerializableConfig = {
    networks: {
      [name]: {
        chainId: chainId,
        transport: `http(process.env.PONDER_RPC_URL_${chainId})`,
      },
    },
    contracts: {
      [contractName]: {
        abi: abiConfig!,
        address: contractAddress,
        network: name,
        startBlock: blockNumber ?? undefined,
      },
    },
  };

  return { config, warnings };
};

const fetchEtherscan = async (url: string) => {
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(url);
      const data = (await response.json()) as any;
      return data;
    } catch (error) {
      retryCount++;
      if (retryCount > maxRetries) {
        throw new Error(`Max retries reached: ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

const getContractCreationTxn = async (
  contractAddress: string,
  apiUrl: string,
  apiKey?: string,
) => {
  const searchParams = new URLSearchParams({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: contractAddress,
  });
  if (apiKey) searchParams.append("apikey", apiKey);
  const data = await fetchEtherscan(`${apiUrl}?${searchParams.toString()}`);

  return data.result[0].txHash as string;
};

const getTxBlockNumber = async (
  txHash: string,
  apiUrl: string,
  apiKey?: string,
) => {
  const searchParams = new URLSearchParams({
    module: "proxy",
    action: "eth_getTransactionByHash",
    txhash: txHash,
  });
  if (apiKey) searchParams.append("apikey", apiKey);
  const data = await fetchEtherscan(`${apiUrl}?${searchParams.toString()}`);

  const hexBlockNumber = data.result.blockNumber as string;
  return parseInt(hexBlockNumber.slice(2), 16);
};

const getContractAbiAndName = async (
  contractAddress: string,
  apiUrl: string,
  apiKey?: string,
) => {
  const searchParams = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address: contractAddress,
  });
  if (apiKey) searchParams.append("apikey", apiKey);
  const data = await fetchEtherscan(`${apiUrl}?${searchParams.toString()}`);

  const abi = data.result[0].ABI as string;
  const contractName = data.result[0].ContractName as string;

  return { abi, contractName };
};

const getProxyImplementationAddresses = async ({
  contractAddress,
  apiUrl,
  fromBlock,
  apiKey,
}: {
  contractAddress: string;
  apiUrl: string;
  fromBlock?: number;
  apiKey?: string;
}) => {
  const searchParams = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: contractAddress,
    fromBlock: fromBlock ? String(fromBlock) : "0",
    toBlock: "latest",
    topic0:
      "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
  });
  if (apiKey) searchParams.append("apikey", apiKey);
  const data = await fetchEtherscan(`${apiUrl}?${searchParams.toString()}`);

  const logs = data.result;

  const implAddresses = logs.map((log: any) => {
    if (log.topics[0] && log.topics[1]) {
      // If there are two topics, this is a compliant EIP-1967 proxy and the address is indexed.
      return `0x${log.topics[1].slice(26)}`;
    } else {
      // If there's only one topic, this might be a non-compliant proxy and the address is not indexed.
      // USDC is an example of this: https://etherscan.io/address/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48#code#L118
      return `0x${log.data.slice(26)}`;
    }
  }) as string[];

  return { implAddresses };
};
