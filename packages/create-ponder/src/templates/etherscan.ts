/* eslint-disable @typescript-eslint/ban-ts-comment */
import { writeFileSync } from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import prettier from "prettier";
import type { PartialPonderConfig } from "src/index";

import type { CreatePonderOptions } from "@/bin/create-ponder";
import { getNetworkByEtherscanHostname } from "@/helpers/getEtherscanChainId";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fromEtherscan = async (options: CreatePonderOptions) => {
  const { ponderRootDir } = options;

  if (!options.fromEtherscan) {
    throw new Error(`Internal error: fromEtherscan undefined`);
  }
  const apiKey = options.etherscanApiKey || process.env.ETHERSCAN_API_KEY;

  const url = new URL(options.fromEtherscan);
  const network = getNetworkByEtherscanHostname(url.hostname);
  if (!network) {
    throw new Error(`Unrecognized etherscan hostname: ${url.hostname}`);
  }

  const apiUrl = `https://api.${url.hostname}/api`;
  const contractAddress = url.pathname.slice(1).split("/")[1];

  const txHash = await getContractCreationTxn(contractAddress, apiUrl, apiKey);

  if (!apiKey) {
    console.log("(1/2) Waiting 5 seconds for Etherscan API rate limit");
    await delay(5000);
  }
  const blockNumber = await getTxBlockNumber(txHash, apiUrl, apiKey);

  if (!apiKey) {
    console.log("(2/2) Waiting 5 seconds for Etherscan API rate limit");
    await delay(5000);
  }
  const { abi, contractName } = await getContractAbiAndName(
    contractAddress,
    apiUrl,
    apiKey
  );

  // Write contract ABI file.
  const abiRelativePath = `./abis/${contractName}.json`;
  const abiAbsolutePath = path.join(ponderRootDir, abiRelativePath);
  writeFileSync(abiAbsolutePath, prettier.format(abi, { parser: "json" }));

  const schemaGraphqlFileContents = `
    type ExampleEntity @entity {
      id: ID!
      name: String!
    }
  `;

  // Generate the schema.graphql file.
  const ponderSchemaFilePath = path.join(ponderRootDir, "schema.graphql");
  writeFileSync(
    ponderSchemaFilePath,
    prettier.format(schemaGraphqlFileContents, { parser: "graphql" })
  );

  // Build and return the partial ponder config.
  const ponderConfig: PartialPonderConfig = {
    plugins: ["graphqlPlugin()"],
    database: {
      kind: "sqlite",
    },
    networks: [
      {
        name: network.name,
        chainId: network.chainId,
        rpcUrl: `process.env.PONDER_RPC_URL_${network.chainId}`,
      },
    ],
    sources: [
      {
        name: contractName,
        network: network.name,
        abi: abiRelativePath,
        address: contractAddress,
        startBlock: blockNumber,
      },
    ],
  };

  return ponderConfig;
};

const fetchEtherscan = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === "0") {
    throw new Error(`Etherscan API error: ${data.result}`);
  }
  return data;
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
