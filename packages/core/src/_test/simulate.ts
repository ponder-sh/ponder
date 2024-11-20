import { toLowerCase } from "@/utils/lowercase.js";
import { http, type Address, type Hex, createWalletClient } from "viem";
import Erc20Bytecode from "./contracts/out/ERC20.sol/ERC20.json";
import FactoryBytecode from "./contracts/out/Factory.sol/Factory.json";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";
import { anvil, publicClient, testClient } from "./utils.js";

/** Deploy Erc20 contract and mine block. */
export const deployErc20 = async (params: { sender: Address }) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.deployContract({
    abi: erc20ABI,
    bytecode: Erc20Bytecode.bytecode.object as Hex,
    args: ["name", "symbol", 18],
  });

  await testClient.mine({ blocks: 1 });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({
    hash,
  });

  return { address: contractAddress!, hash };
};

/** Deploy Factory contract and mine block. */
export const deployFactory = async (params: { sender: Address }) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.deployContract({
    abi: factoryABI,
    bytecode: FactoryBytecode.bytecode.object as Hex,
  });

  await testClient.mine({ blocks: 1 });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({
    hash,
  });

  return { address: contractAddress!, hash };
};

/** Mint Erc20 tokens and mine block. */
export const mintErc20 = async (params: {
  erc20: Address;
  to: Address;
  amount: bigint;
  sender: Address;
}) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: params.erc20,
    args: [params.to, params.amount],
  });

  await testClient.mine({ blocks: 1 });
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash };
};

/** Transfer Erc20 tokens and mine block. */
export const transferErc20 = async (params: {
  erc20: Address;
  to: Address;
  amount: bigint;
  sender: Address;
}) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "transfer",
    address: params.erc20,
    args: [params.to, params.amount],
  });

  await testClient.mine({ blocks: 1 });
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash };
};

/** Create pair and mine block. */
export const createPair = async (params: {
  factory: Address;
  sender: Address;
}) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const { result, request } = await publicClient.simulateContract({
    abi: factoryABI,
    functionName: "createPair",
    address: params.factory,
  });

  const hash = await walletClient.writeContract(request);

  await testClient.mine({ blocks: 1 });
  await publicClient.waitForTransactionReceipt({
    hash,
  });

  return { result: toLowerCase(result), hash };
};

/** Swap tokens in pair and mine block. */
export const swapPair = async (params: {
  pair: Address;
  amount0Out: bigint;
  amount1Out: bigint;
  to: Address;
  sender: Address;
}) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.writeContract({
    abi: pairABI,
    functionName: "swap",
    address: params.pair,
    args: [params.amount0Out, params.amount1Out, params.to],
  });

  await testClient.mine({ blocks: 1 });
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash };
};

/** Transfer native tokens and mine block. */
export const transferEth = async (params: {
  to: Address;
  amount: bigint;
  sender: Address;
}) => {
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: params.sender,
  });

  const hash = await walletClient.sendTransaction({
    to: params.to,
    value: params.amount,
  });

  await testClient.mine({ blocks: 1 });
  await publicClient.waitForTransactionReceipt({ hash });

  return { hash };
};
