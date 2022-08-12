import { getAddress } from "@ethersproject/address";

export const formatAddress = (address: string) => {
  try {
    return getAddress(address);
  } catch (error) {
    return address;
  }
};
