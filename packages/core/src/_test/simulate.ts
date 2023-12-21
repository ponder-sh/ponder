import { type Address, type Hex, parseEther } from "viem";

import { ALICE, BOB } from "./constants.js";
import Erc20Bytecode from "./contracts/out/ERC20.sol/ERC20.json";
import FactoryBytecode from "./contracts/out/Factory.sol/Factory.json";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";
import { publicClient, testClient, walletClient } from "./utils.js";

/**
 * Deploy Two ERC20 tokens and a Factory contract. All happens in one block.
 */
export const deploy = async () => {
  const deployHashErc20 = await walletClient.deployContract({
    abi: erc20ABI,
    bytecode: Erc20Bytecode.bytecode.object as Hex,
    args: ["name", "symbol", 18],
  });

  const deployHashFactory = await walletClient.deployContract({
    abi: factoryABI,
    bytecode: FactoryBytecode.bytecode.object as Hex,
  });

  await testClient.mine({ blocks: 1 });

  const { contractAddress: erc20Address } =
    await publicClient.waitForTransactionReceipt({
      hash: deployHashErc20,
    });
  const { contractAddress: factoryAddress } =
    await publicClient.waitForTransactionReceipt({
      hash: deployHashFactory,
    });
  return {
    erc20Address: erc20Address!,
    factoryAddress: factoryAddress!,
  };
};

/**
 * Simulate network activity
 *
 * 1) Mint one tokens to Alice
 * 2) Transfer one token from Alice to Bob
 * 3) Create a pair
 * 4) Swap on created pair
 *
 * Blocks are created after 2, 3, and 4.
 *
 * @returns The pair address
 */
export const simulate = async (
  addresses: Awaited<ReturnType<typeof deploy>>,
): Promise<Address> => {
  // Mint 1 token to ALICE
  const mintHash = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: addresses.erc20Address,
    args: [ALICE, parseEther("1")],
  });

  // Transfer 1 token from ALICE to BOB
  const transferHash = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "transfer",
    address: addresses.erc20Address,
    args: [BOB, parseEther("1")],
  });

  await testClient.mine({ blocks: 1 });

  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  await publicClient.waitForTransactionReceipt({ hash: transferHash });

  const { result, request } = await publicClient.simulateContract({
    abi: factoryABI,
    functionName: "createPair",
    address: addresses.factoryAddress,
  });
  const createPairHash = await walletClient.writeContract(request);

  await testClient.mine({ blocks: 1 });

  await publicClient.waitForTransactionReceipt({
    hash: createPairHash,
  });

  const swapHash = await walletClient.writeContract({
    abi: pairABI,
    functionName: "swap",
    address: result,
    args: [1n, 2n, ALICE],
  });

  await testClient.mine({ blocks: 1 });

  await publicClient.waitForTransactionReceipt({ hash: swapHash });

  return result;
};
