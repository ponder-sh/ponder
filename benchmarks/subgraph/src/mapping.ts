import { BigInt } from "@graphprotocol/graph-ts";

import {
  Approval as TApprovalEvent,
  Transfer as TTransferEvent,
} from "../generated/RocketTokenRETH/RocketTokenRETH";
import {
  Account,
  Approval,
  ApprovalEvent,
  TransferEvent,
} from "../generated/schema";

export function handleTransfer(event: TTransferEvent): void {
  const params = event.params;

  // Create an Account for the sender, or update the balance if it already exists.
  let sender = Account.load(params.from.toHexString());
  if (!sender) {
    sender = new Account(params.from.toHexString());
    sender.balance = BigInt.fromI32(0);
    sender.isOwner = false;
  } else {
    sender.balance = sender.balance.minus(params.value);
  }
  sender.save();

  // Create an Account for the recipient, or update the balance if it already exists.
  let recipient = Account.load(params.to.toHexString());
  if (!recipient) {
    recipient = new Account(params.to.toHexString());
    recipient.balance = params.value;
    recipient.isOwner = false;
  } else {
    recipient.balance = recipient.balance.plus(params.value);
  }
  recipient.save();

  const transferEventId =
    event.block.number.toString() + "-" + event.logIndex.toString();

  // Create a TransferEvent.
  const transferEvent = new TransferEvent(transferEventId);
  transferEvent.from = params.from.toHexString();
  transferEvent.to = params.to.toHexString();
  transferEvent.amount = params.value;
  transferEvent.timestamp = event.block.timestamp.toI32();
  transferEvent.save();
}

export function handleApproval(event: TApprovalEvent): void {
  const params = event.params;
  const approvalId =
    params.owner.toHexString() + "-" + params.spender.toHexString();

  // Create or update the Approval.
  const approval = new Approval(approvalId);
  approval.owner = params.owner.toHexString();
  approval.spender = params.spender.toHexString();
  approval.amount = params.value;
  approval.save();

  const approvalEventId =
    event.block.number.toString() + "-" + event.logIndex.toString();

  // Create an ApprovalEvent.
  const approvalEvent = new ApprovalEvent(approvalEventId);
  approvalEvent.owner = params.owner.toHexString();
  approvalEvent.spender = params.spender.toHexString();
  approvalEvent.amount = params.value;
  approvalEvent.timestamp = event.block.timestamp.toI32();
  approvalEvent.save();
}
