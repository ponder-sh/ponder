/* eslint-disable @typescript-eslint/ban-ts-comment */
import { writeFileSync } from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import prettier from "prettier";
import type { PartialPonderConfig } from "src/index";

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

  const txHash = await getContractCreationTxn(contractAddress, apiUrl, apiKey);

  if (!apiKey) {
    console.log("\n(1/2) Waiting 5 seconds for Etherscan API rate limit");
    await wait(5000);
  }
  const blockNumber = await getTxBlockNumber(txHash, apiUrl, apiKey);

  if (!apiKey) {
    console.log("(2/2) Waiting 5 seconds for Etherscan API rate limit");
    await wait(5000);
  }
  const { abi, contractName } = await getContractAbiAndName(
    contractAddress,
    apiUrl,
    apiKey
  );

  // Write contract ABI file.
  const abiRelativePath = `./abis/${contractName}.json`;
  const abiAbsolutePath = path.join(rootDir, abiRelativePath);
  writeFileSync(abiAbsolutePath, prettier.format(abi, { parser: "json" }));

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
  const ponderConfig: PartialPonderConfig = {
    networks: [
      {
        name: name,
        chainId: chainId,
        rpcUrl: `process.env.PONDER_RPC_URL_${chainId}`,
      },
    ],
    contracts: [
      {
        name: contractName,
        network: name,
        abi: abiRelativePath,
        address: contractAddress,
        startBlock: blockNumber,
      },
    ],
  };

  return ponderConfig;
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
