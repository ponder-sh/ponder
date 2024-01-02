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

const delim = "dif:-";

export function handleTransfer(event: TTransferEvent): void {
  // Create an Account for the sender, or update the balance if it already exists.
  let sender = Account.load(event.params.from.toHexString());
  if (!sender) {
    sender = new Account(event.params.from.toHexString());
    sender.balance = BigInt.fromI32(0);
    sender.isOwner = false;
  } else {
    sender.balance = sender.balance.minus(event.params.value);
  }
  sender.save();

  // Create an Account for the recipient, or update the balance if it already exists.
  let recipient = Account.load(event.params.to.toHexString());
  if (!recipient) {
    recipient = new Account(event.params.to.toHexString());
    recipient.balance = event.params.value;
    recipient.isOwner = false;
  } else {
    recipient.balance = recipient.balance.plus(event.params.value);
  }
  recipient.save();

  const transferEventId =
    event.block.number.toString() + delim + event.logIndex.toString();

  // Create a TransferEvent.
  const transferEvent = new TransferEvent(transferEventId);
  transferEvent.from = event.params.from.toHexString();
  transferEvent.to = event.params.to.toHexString();
  transferEvent.amount = event.params.value;
  transferEvent.timestamp = event.block.timestamp.toI32();
  transferEvent.save();
}

export function handleApproval(event: TApprovalEvent): void {
  const approvalId =
    event.params.owner.toHexString() +
    delim +
    event.params.spender.toHexString();

  // Create or update the Approval.
  const approval = new Approval(approvalId);
  approval.owner = event.params.owner.toHexString();
  approval.spender = event.params.spender.toHexString();
  approval.amount = event.params.value;
  approval.save();

  const approvalEventId =
    event.block.number.toString() + delim + event.logIndex.toString();

  // Create an ApprovalEvent.
  const approvalEvent = new ApprovalEvent(approvalEventId);
  approvalEvent.owner = event.params.owner.toHexString();
  approvalEvent.spender = event.params.spender.toHexString();
  approvalEvent.amount = event.params.value;
  approvalEvent.timestamp = event.block.timestamp.toI32();
  approvalEvent.save();
}
