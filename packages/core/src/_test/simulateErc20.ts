import { type Address, type Hex, parseEther } from "viem";

import { ALICE, BOB } from "./constants.js";
import Erc20Bytecode from "./contracts/out/ERC20.sol/ERC20.json";
import { erc20ABI } from "./generated.js";
import { publicClient, testClient, walletClient } from "./utils.js";

export const deployErc20 = async () => {
  const deployHash = await walletClient.deployContract({
    account: ALICE,
    abi: erc20ABI,
    bytecode: Erc20Bytecode.bytecode.object as Hex,
    args: ["name", "symbol", 18],
  });

  await testClient.mine({ blocks: 1 });

  const { contractAddress } = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  return contractAddress!;
};

export const simulateErc20 = async (erc20Address: Address): Promise<void> => {
  // Mint 1 token to ALICE
  const mintHashALICE = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: erc20Address,
    args: [ALICE, parseEther("1")],
  });

  // Mint 1 tokens to BOB
  const mintHashBOB = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: erc20Address,
    args: [BOB, parseEther("1")],
  });

  await testClient.mine({ blocks: 1 });

  await publicClient.waitForTransactionReceipt({ hash: mintHashALICE });
  await publicClient.waitForTransactionReceipt({ hash: mintHashBOB });

  // Transfer 1 token from ALICE to BOB
  const transferHash1 = await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "transfer",
    address: erc20Address,
    args: [BOB, parseEther("1")],
  });

  await testClient.mine({ blocks: 1 });

  await publicClient.waitForTransactionReceipt({ hash: transferHash1 });
};
