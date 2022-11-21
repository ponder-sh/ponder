import { BigNumber } from "ethers";

import { ApprovalHandler, TransferHandler } from "../generated/handlers";

const handleTransfer: TransferHandler = async (event, context) => {
  const { block } = event;
  const { Account } = context.entities;
  const { src, dst, wad } = event.params;

  const existingSrcAccount = await Account.get(src);
  if (existingSrcAccount) {
    await Account.update(existingSrcAccount.id, {
      id: existingSrcAccount.id,
      balance: BigNumber.from(existingSrcAccount.balance).sub(wad).toString(),
      lastActivityTimestamp: block.timestamp,
    });
  } else {
    await Account.insert(src, {
      id: src,
      balance: wad.toString(),
      lastActivityTimestamp: block.timestamp,
    });
  }

  const existingDstAccount = await Account.get(dst);
  if (existingDstAccount) {
    await Account.update(existingDstAccount.id, {
      id: existingDstAccount.id,
      balance: BigNumber.from(existingDstAccount.balance).add(wad).toString(),
      lastActivityTimestamp: block.timestamp,
    });
  } else {
    await Account.insert(dst, {
      id: dst,
      balance: wad.toString(),
      lastActivityTimestamp: block.timestamp,
    });
  }
};

const handleApproval: ApprovalHandler = async (event, context) => {
  const { Allowance } = context.entities;
  const { src, guy, wad } = event.params;

  const allowanceId = `${src}-${guy}`;

  const existingAllowance = await Allowance.get(allowanceId);
  if (existingAllowance) {
    await Allowance.update(existingAllowance.id, {
      id: existingAllowance.id,
      amount: BigNumber.from(existingAllowance.amount).add(wad).toString(),
    });
  } else {
    await Allowance.insert(allowanceId, {
      id: allowanceId,
      owner: src,
      spender: guy,
      amount: wad.toString(),
    });
  }
};

export const WETH = {
  Transfer: handleTransfer,
  Approval: handleApproval,
};
