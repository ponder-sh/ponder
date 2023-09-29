/* eslint-disable @typescript-eslint/ban-ts-comment */
import { writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import type { PartialConfig } from "src/index";
import { http } from "viem";

import { getNetworkByEtherscanHostname } from "@/helpers/getEtherscanChainId";
import { wait } from "@/helpers/wait";

export const fromEtherscan = async ({
  rootDir,
  etherscanLink,
  etherscanApiKey,
}: {
  rootDir: string;
  etherscanLink: string;
  etherscanApiKey?: string;
}) => {
  const apiKey = etherscanApiKey || process.env.ETHERSCAN_API_KEY;

  const url = new URL(etherscanLink);
  const network = getNetworkByEtherscanHostname(url.hostname);
  if (!network) {
    throw new Error(`Unrecognized etherscan hostname: ${url.hostname}`);
  }

  const { name, chainId, apiUrl } = network;
  const contractAddress = url.pathname.slice(1).split("/")[1];

  let blockNumber: number | undefined = undefined;

  try {
    const txHash = await getContractCreationTxn(
      contractAddress,
      apiUrl,
      apiKey
    );

    if (!apiKey) {
      console.log("\n(1/n) Waiting 5 seconds for Etherscan API rate limit");
      await wait(5000);
    }
    const contractCreationBlockNumber = await getTxBlockNumber(
      txHash,
      apiUrl,
      apiKey
    );

    blockNumber = contractCreationBlockNumber;
  } catch (error) {
    // Do nothing, blockNumber won't be set.
  }

  if (!apiKey) {
    console.log("(2/n) Waiting 5 seconds for Etherscan API rate limit");
    await wait(5000);
  }
  const abis: { abi: string; contractName: string }[] = [];
  const { abi, contractName } = await getContractAbiAndName(
    contractAddress,
    apiUrl,
    apiKey
  );
  abis.push({ abi, contractName });

  // If the contract is an EIP-1967 proxy, get the implementation contract ABIs.
  if (
    (JSON.parse(abi) as any[]).find(
      (item) =>
        item.type === "event" &&
        item.name === "Upgraded" &&
        item.inputs[0].name === "implementation"
    )
  ) {
    console.log(
      "Detected EIP-1967 proxy, fetching implementation contract ABIs"
    );
    if (!apiKey) {
      console.log("(3/n) Waiting 5 seconds for Etherscan API rate limit");
      await wait(5000);
    }
    const { implAddresses } = await getProxyImplementationAddresses({
      contractAddress,
      apiUrl,
      fromBlock: blockNumber,
      apiKey,
    });

    for (const [index, implAddress] of implAddresses.entries()) {
      console.log(`Fetching ABI for implementation contract: ${implAddress}`);
      if (!apiKey) {
        console.log(
          `(${4 + index}/${
            4 + implAddresses.length - 1
          }) Waiting 5 seconds for Etherscan API rate limit`
        );
        await wait(5000);
      }
      const { abi, contractName } = await getContractAbiAndName(
        implAddress,
        apiUrl,
        apiKey
      );

      abis.push({
        abi,
        contractName: `${contractName}_${implAddress.slice(0, 6)}`,
      });
    }
  }

  // Write ABI files.
  let abiConfig: any;
  abis.forEach(({ abi, contractName }) => {
    const abiRelativePath = `./abis/${contractName}.json`;
    const abiAbsolutePath = path.join(rootDir, abiRelativePath);
    writeFileSync(abiAbsolutePath, prettier.format(abi, { parser: "json" }));

    if (abis.length === 1) {
      abiConfig = abiRelativePath;
    } else {
      abiConfig ||= [];
      abiConfig.push(abiRelativePath);
    }
  });

  const schemaGraphqlFileContents = `
    type ExampleEntity @entity {
      id: String!
      name: String!
    }
  `;

  // Generate the schema.graphql file.
  const ponderSchemaFilePath = path.join(rootDir, "schema.graphql");
  writeFileSync(
    ponderSchemaFilePath,
    prettier.format(schemaGraphqlFileContents, { parser: "graphql" })
  );

  // Build and return the partial ponder config.
  const config: PartialConfig = {
    networks: [
      {
        name: name,
        chainId: chainId,
        transport: http(`process.env.PONDER_RPC_URL_${chainId}`),
      },
    ],
    contracts: [
      {
        name: contractName,
        network: name,
        abi: abiConfig,
        address: contractAddress,
        startBlock: blockNumber ?? undefined,
      },
    ],
  };

  return config;
};

const fetchEtherscan = async (url: string) => {
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === "0") {
        throw new Error(`Etherscan API error: ${data.result}`);
      }
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
  apiKey?: string
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
  apiKey?: string
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
  apiKey?: string
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
