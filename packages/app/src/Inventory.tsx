import { gql } from "urql";
import { useAccount } from "wagmi";

import { useInventoryQuery } from "../codegen/subgraph";
import { exampleNFTContract } from "./contracts";
import { PendingIcon } from "./PendingIcon";
import { useIsMounted } from "./useIsMounted";

gql`
  query Inventory($owner: Bytes!) {
    tokens(where: { owner: $owner }, first: 100) {
      id
      tokenURI
    }
  }
`;

export const Inventory = () => {
  const { address } = useAccount();

  const [query] = useInventoryQuery({
    pause: !address,
    variables: {
      owner: address?.toLowerCase(),
    },
  });

  // Temporarily workaround hydration issues where server-rendered markup
  // doesn't match the client due to localStorage caching in wagmi
  // See https://github.com/holic/web3-scaffold/pull/26
  const isMounted = useIsMounted();
  if (!isMounted) {
    return null;
  }

  if (!address) {
    return null;
  }

  if (!query.data) {
    return <PendingIcon />;
  }

  return (
    <div className="flex flex-col">
      <div className="uppercase text-sm text-slate-500 font-semibold">
        Inventory
      </div>
      <div className="grid grid-cols-3">
        {query.data.tokens.map((token) => (
          <a
            key={token.id}
            href={`https://testnets.opensea.io/goerli/${exampleNFTContract.address}/${token.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 border-2 border-slate-200 hover:border-sky-400 p-2 leading-none rounded-md"
          >
            Token #{token.id}
          </a>
        ))}
      </div>
    </div>
  );
};
