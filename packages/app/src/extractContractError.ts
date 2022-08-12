import { ExampleNFT__factory } from "@web3-scaffold/contracts/types";

const contractInterface = ExampleNFT__factory.createInterface();

// for (const [error, errorFragment] of Object.entries(contractInterface.errors)) {
//   console.log(contractInterface.getSighash(errorFragment), errorFragment.name);
// }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractContractError = (error: any): string => {
  console.dir(error);

  // Attempt to extract Solidity error
  const errorData = error.error?.data?.originalError?.data;
  if (typeof errorData === "string") {
    console.log("found error data in original error, write call?", errorData);
    for (const [, errorFragment] of Object.entries(contractInterface.errors)) {
      if (errorData.startsWith(contractInterface.getSighash(errorFragment))) {
        // const args = contractInterface.decodeErrorResult(errorFragment, errorData)
        return errorFragment.name;
      }
    }
  }

  // Read calls will revert differently
  try {
    const response = JSON.parse(error.error.response);
    const errorData = response.error.data;
    console.log("found error data in error response, read call?", errorData);
    if (typeof errorData === "string") {
      for (const [, errorFragment] of Object.entries(
        contractInterface.errors
      )) {
        if (errorData.startsWith(contractInterface.getSighash(errorFragment))) {
          // const args = contractInterface.decodeErrorResult(errorFragment, errorData)
          return errorFragment.name;
        }
      }
    }
  } catch (error) {
    // do nothing with the parse error so we can continue on
  }

  // Otherwise return error reason
  if (typeof error.reason === "string") {
    return error.reason;
  }
  // Fall back to error message
  return error.message;
};
