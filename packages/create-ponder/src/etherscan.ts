import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { wait } from "@/helpers/wait.js";
import type { SerializableConfig, SerializableContract } from "@/index.js";
import type { Abi } from "abitype";
import pico from "picocolors";
import prettier from "prettier";
import type { Chain } from "viem";
import * as chains from "viem/chains";

const chainsByExplorerHostname: Map<string, Chain> = new Map();
for (const chain_ of Object.values(chains)) {
  const chain = chain_ as Chain;

  const explorers = Object.values(chain.blockExplorers ?? {});
  const hostnames = explorers.flatMap((explorer) => [
    new URL(explorer.url).hostname,
    ...(explorer.apiUrl ? [new URL(explorer.apiUrl).hostname] : []),
  ]);

  for (const hostname of hostnames) {
    chainsByExplorerHostname.set(hostname, chain);
  }
}

export const PUBLIC_ETHERSCAN_API_KEY = "JU6GP915F8WU6EBM2S8XJVJR87DDEB5CF3";

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

  const apiKey =
    etherscanApiKey ??
    process.env.ETHERSCAN_API_KEY ??
    PUBLIC_ETHERSCAN_API_KEY;

  const url = new URL(etherscanLink);
  const hostname = url.hostname;

  const pathComponents = url.pathname.slice(1).split("/");
  const contractAddress = pathComponents[1];

  if (
    pathComponents[0] !== "address" ||
    !(typeof contractAddress === "string") ||
    !contractAddress.startsWith("0x")
  ) {
    throw new Error(
      `${pico.red("✗")} Invalid block explorer URL (${
        url.href
      }). Expected path "/address/<contract-address>".`,
    );
  }

  const chain = chainsByExplorerHostname.get(hostname) ?? null;

  const apiUrl = await getEtherscanApiUrl(hostname, apiKey);

  const etherscanRequest = async (searchParams: URLSearchParams) => {
    const url = new URL(apiUrl.toString());
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
    url.searchParams.append("apikey", apiKey);
    await wait(1000);
    return await fetchWithRetry(url.toString());
  };

  const abiResult = await getContractAbiAndName(
    contractAddress,
    etherscanRequest,
  );

  warnings.push(...abiResult.warnings);

  const baseAbi = abiResult.abi;
  let contractName = abiResult.contractName;

  const abis: { abi: Abi; contractName: string }[] = [
    { abi: baseAbi, contractName },
  ];

  let blockNumber: number | undefined = undefined;
  try {
    const txHash = await getContractCreationTxn(
      contractAddress,
      etherscanRequest,
    );

    const contractCreationBlockNumber = await getTxBlockNumber(
      txHash,
      etherscanRequest,
    );

    blockNumber = contractCreationBlockNumber;
  } catch (e) {
    const error = e as Error;
    warnings.push(
      `Unable to fetch contract deployment block number from block explorer. Error: ${error.message}`,
    );
  }

  // If the contract is an EIP-1967 proxy, get the implementation contract ABIs.
  if (
    baseAbi.find(
      (item) =>
        item.type === "event" &&
        item.name === "Upgraded" &&
        item.inputs[0]!.name === "implementation",
    )
  ) {
    const { implAddresses } = await getProxyImplementationAddresses({
      contractAddress,
      fromBlock: blockNumber,
      etherscanRequest,
    });

    for (const implAddress of implAddresses) {
      const abiResult = await getContractAbiAndName(
        implAddress,
        etherscanRequest,
      );

      warnings.push(...abiResult.warnings);

      abis.push({
        abi: abiResult.abi,
        contractName: `${abiResult.contractName}_${implAddress.slice(0, 6)}`,
      });

      // Also update the top-level contract name to the last-in impl contract name.
      contractName = abiResult.contractName;
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
        {
          parser: "typescript",
        },
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
  const chainName = chain?.name ?? "unknown";
  const chainId = chain?.id ?? 0;

  const config: SerializableConfig = {
    chains: {
      [chainName]: {
        id: chainId,
        rpc: `http(process.env.PONDER_RPC_URL_${chainId})`,
      },
    },
    contracts: {
      [contractName]: {
        abi: abiConfig!,
        address: contractAddress,
        chain: chainName,
        startBlock: blockNumber ?? undefined,
      },
    },
  };

  return { config, warnings };
};

const getContractCreationTxn = async (
  contractAddress: string,
  etherscanRequest: (searchParams: URLSearchParams) => Promise<any>,
) => {
  const searchParams = new URLSearchParams({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: contractAddress,
  });
  const data = await etherscanRequest(searchParams);

  return data.result[0].txHash as string;
};

const getTxBlockNumber = async (
  txHash: string,
  etherscanRequest: (searchParams: URLSearchParams) => Promise<any>,
) => {
  const searchParams = new URLSearchParams({
    module: "proxy",
    action: "eth_getTransactionByHash",
    txhash: txHash,
  });
  const data = await etherscanRequest(searchParams);

  const hexBlockNumber = data.result.blockNumber as string;
  return Number.parseInt(hexBlockNumber.slice(2), 16);
};

const getContractAbiAndName = async (
  contractAddress: string,
  etherscanRequest: (searchParams: URLSearchParams) => Promise<any>,
) => {
  const warnings: string[] = [];
  let abi: Abi;
  let contractName: string;

  try {
    const searchParams = new URLSearchParams({
      module: "contract",
      action: "getsourcecode",
      address: contractAddress,
    });
    const data = await etherscanRequest(searchParams);

    const rawAbi = data.result[0].ABI as string;
    if (rawAbi === "Contract source code not verified") {
      warnings.push(
        `Contract ${contractAddress} is unverified or has an empty ABI.`,
      );
      abi = [];
    } else {
      abi = JSON.parse(rawAbi);
    }

    contractName = data.result[0].ContractName ?? "";
    if (contractName === "") contractName = "UnverifiedContract";
  } catch (e) {
    const error = e as Error;
    warnings.push(
      `Failed to fetch ABI for contract ${contractAddress}. Marking as unverified. Error: ${error.message}`,
    );
    abi = [];
    contractName = "UnverifiedContract";
  }

  return { abi, contractName, warnings };
};

const getProxyImplementationAddresses = async ({
  contractAddress,
  fromBlock,
  etherscanRequest,
}: {
  contractAddress: string;
  fromBlock?: number;
  etherscanRequest: (searchParams: URLSearchParams) => Promise<any>;
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
  const data = await etherscanRequest(searchParams);

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

/**
 * 1) If the chain is not present in viem/chains, make a hail mary attempt to
 *    infer an Etherscan V1 API URL from the provided hostname. If that fails,
 *    throw an error that the chain was not found in viem/chains.
 * 2) Try the Etherscan V2 API using the chain ID from viem/chains.
 * 3) Try the explorer API URL associated with the provided hostname from viem/chains.
 * 4) Try any other block explorer API URLs present in viem/chains.
 * 5) Throw an error that no valid explorer API URL was found.
 */
export async function getChainUrls(hostname: string, apiKey: string) {
  const chain = chainsByExplorerHostname.get(hostname) ?? null;
  if (chain === null) {
    const possibleApiUrl = `https://api.${hostname}/api`;
    const isEtherscanApi = await testEtherscanApi(possibleApiUrl, apiKey);
    if (isEtherscanApi) {
      return {
        rpc: null,
        blockscout: null,
        etherscanV2: new URL(possibleApiUrl),
      };
    } else {
      throw new Error(
        `Block explorer (${hostname}) is not present in viem/chains.`,
      );
    }
  }

  const etherscanV2ApiUrl = `https://api.etherscan.io/v2/api?chainid=${chain.id}`;

  const matchedViemExplorerApiUrl = Object.values(
    chain.blockExplorers ?? {},
  ).find(
    (explorer) =>
      explorer.url.includes(hostname) || explorer.apiUrl?.includes(hostname),
  )?.apiUrl;

  const otherViemExplorerApiUrls = Object.values(chain.blockExplorers ?? {})
    .map((explorer) => explorer.apiUrl)
    .filter(
      (apiUrl): apiUrl is string =>
        apiUrl !== undefined && apiUrl !== matchedViemExplorerApiUrl,
    );

  const possibleApiUrls = [
    etherscanV2ApiUrl,
    matchedViemExplorerApiUrl,
    ...otherViemExplorerApiUrls,
  ].filter((apiUrl): apiUrl is string => apiUrl !== undefined);

  for (const apiUrl of possibleApiUrls) {
    const isEtherscanApi = await testEtherscanApi(apiUrl, apiKey);
    if (isEtherscanApi) {
      return new URL(apiUrl);
    }
  }

  throw new Error(
    `Block explorer (${hostname}) does not have a valid API URL registered in viem/chains.`,
  );
}

async function testEtherscanApi(baseUrl: string, apiKey: string) {
  const url = new URL(baseUrl);
  // url.searchParams.append("module", "proxy");
  // url.searchParams.append("action", "eth_blockNumber");
  url.searchParams.append("module", "block");
  url.searchParams.append("action", "eth_block_number");
  url.searchParams.append("apikey", apiKey);
  try {
    console.log(url.toString());
    const res = await fetch(url.toString());
    const body = (await res.json()) as any;

    if (res.ok === false || body.status === "0" || body.message === "NOTOK") {
      console.log(body);
      return false;
    }

    // Example response
    // {
    //   status: '0',
    //   message: 'NOTOK',
    //   result: 'Missing or unsupported chainid parameter (required for v2 api), please see https://api.etherscan.io/v2/chainlist for the list of supported chainids'
    // }

    return true;
  } catch (e) {
    return false;
  }
}

const fetchWithRetry = async (url: string) => {
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
