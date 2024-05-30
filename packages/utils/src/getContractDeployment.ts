import type { Address, Hex } from "viem";

type Broadcast = {
  transactions: {
    hash: Hex;
    transactionType: "CREATE";
    contractName: string;
    contractAddress: Address;
  }[];
  receipts: {
    status: Hex;
    transactionHash: Hex;
    blockHash: Hex;
    blockNumber: Hex;
    contractAddress: Address;
  }[];
};

export const getContractDeployment = (
  broadcast: Broadcast,
  { contractName }: { contractName?: string } = {},
): { address: Address; startBlock: number; contractName: string }[] => {
  const deployments: {
    address: Address;
    startBlock: number;
    contractName: string;
  }[] = [];

  for (const transaction of broadcast.transactions) {
    if (transaction.transactionType !== "CREATE") continue;
    if (contractName !== undefined && transaction.contractName !== contractName)
      continue;

    const receipt = broadcast.receipts.find(
      (r) => r.transactionHash === transaction.hash,
    )!;

    if (receipt.status !== "0x1") continue;

    deployments.push({
      address: transaction.contractAddress,
      startBlock: Number(receipt.blockNumber),
      contractName: transaction.contractName,
    });
  }

  return deployments;
};
