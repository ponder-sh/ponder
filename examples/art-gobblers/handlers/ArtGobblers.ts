import {
  ApprovalForAllHandler,
  ApprovalHandler,
  ArtGobbledHandler,
  GobblerClaimedHandler,
  GobblerPurchasedHandler,
  GobblersRevealedHandler,
  GooBalanceUpdatedHandler,
  LegendaryGobblerMintedHandler,
  OwnershipTransferredHandler,
  RandomnessFulfilledHandler,
  RandomnessRequestedHandler,
  RandProviderUpgradedHandler,
  ReservedGobblersMintedHandler,
  TransferHandler,
} from "../generated/ArtGobblers";

const handleApproval: ApprovalHandler = async (event, context) => {
  return;
};

const handleApprovalForAll: ApprovalForAllHandler = async (event, context) => {
  return;
};

const handleArtGobbled: ArtGobbledHandler = async (event, context) => {
  return;
};

const handleGobblerClaimed: GobblerClaimedHandler = async (event, context) => {
  return;
};

const handleGobblerPurchased: GobblerPurchasedHandler = async (
  event,
  context
) => {
  return;
};

const handleGobblersRevealed: GobblersRevealedHandler = async (
  event,
  context
) => {
  return;
};

const handleGooBalanceUpdated: GooBalanceUpdatedHandler = async (
  event,
  context
) => {
  return;
};

const handleLegendaryGobblerMinted: LegendaryGobblerMintedHandler = async (
  event,
  context
) => {
  return;
};

const handleOwnershipTransferred: OwnershipTransferredHandler = async (
  event,
  context
) => {
  return;
};

const handleRandProviderUpgraded: RandProviderUpgradedHandler = async (
  event,
  context
) => {
  return;
};

const handleRandomnessFulfilled: RandomnessFulfilledHandler = async (
  event,
  context
) => {
  return;
};

const handleRandomnessRequested: RandomnessRequestedHandler = async (
  event,
  context
) => {
  return;
};

const handleReservedGobblersMinted: ReservedGobblersMintedHandler = async (
  event,
  context
) => {
  return;
};

const handleTransfer: TransferHandler = async (event, context) => {
  return;
};

export const ArtGobblers = {
  Approval: handleApproval,
  ApprovalForAll: handleApprovalForAll,
  ArtGobbled: handleArtGobbled,
  GobblerClaimed: handleGobblerClaimed,
  GobblerPurchased: handleGobblerPurchased,
  GobblersRevealed: handleGobblersRevealed,
  GooBalanceUpdated: handleGooBalanceUpdated,
  LegendaryGobblerMinted: handleLegendaryGobblerMinted,
  OwnershipTransferred: handleOwnershipTransferred,
  RandProviderUpgraded: handleRandProviderUpgraded,
  RandomnessFulfilled: handleRandomnessFulfilled,
  RandomnessRequested: handleRandomnessRequested,
  ReservedGobblersMinted: handleReservedGobblersMinted,
  Transfer: handleTransfer,
};
