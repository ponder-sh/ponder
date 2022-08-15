import { NewRegistrationHandler } from "../generated/RegistryReceiverV0";

const handleNewRegistration: NewRegistrationHandler = async (
  event,
  context
) => {
  const { Player } = context.entities;

  const { account, burnerAccount } = event.params;

  await Player.insert({
    account: account,
    burnerAccount: burnerAccount,
    score: 123,
  });
};

const RegistryReceiverV0 = {
  NewRegistration: handleNewRegistration,
};

export { RegistryReceiverV0 };
