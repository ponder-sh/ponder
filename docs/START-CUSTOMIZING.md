# Getting Started

web3-scaffold works *almost* out of the box, so install and experiement. The ExampleNFT contract is already deployed and ready to interact with : ) 

## First time setup

From the root, run:

```
$ pnpm install
```
Next, setup your local env:
- Copy `./packages/app/.env` to `./pacages/app/.env.local`
- Add your alchemy key to the `NEXT_PUBLIC_ALCHEMY_API_KEY` ENV var

Now start the app. From the root folder run:
```
$ pnpm run dev
```

And you should see a link to localhost in the console. Try it out!

## Customize Your Smart Contract

Here's a quick guide on how to start customizing your app.

1. Setup your local ENV
    - Copy `./packages/contracts/.env` to `./pacages/contracts/.env.local`
    - Add your ENV vars:
        - `DEPLOYER` - Wallet address that is deploying
        - `DEPLOYER_PRIVATE_KEY` - Private key for this address
        - `CHAIN_NAME` - Defaults to `goerli`
        - `RPC_URL` - Get this from Alchemy or Infura
        - `ETHERSCAN_API_KEY` - Free to create if you setup an Etherscan account

2. If you'd like a fresh git repo:
    - Delete the `.git` folder, and then `git init` to re-create.
3. Create/copy your custom contract to `./packages/src`
    - i.e. MyContract.sol
4. Run `forge build` or `forge test` from the root directory
    - You need to build your contract at least once
5. Update the `./packages/contracts/deploy.sh` script to use the proper contract name and any require constructor args. Below is an example: 

```bash
CONTRACT_NAME="MyContract"

...

if [ ! -f $DEPLOY_OUTPUT ] || [ ! -s $DEPLOY_OUTPUT ]; then
  forge create $CONTRACT_NAME --json \
    --constructor-args "0xOwnerAddress" "baseUri" \
    --rpc-url=$RPC_URL \
    --private-key=$DEPLOYER_PRIVATE_KEY | jq . > $DEPLOY_OUTPUT
fi
```

6. If needed, install jq
    - `$ brew install jq` on Mac

7. CD into `./packages/contracts` and run `./deploy.sh`
    - If successful you should see output similar to:

    ```Using goerli contract address: 0x00...```

8. Your custom contract is now deployed! The last step here is to generate your type definitions for the front-end dapp:
    - from the packages/contracts folder, run `pnpm run types`

## Customizing The Dapp
1. You should have already setup your ENV, but if not, copy `.env` to `.env.local`
    - Add your alchemy key to the `NEXT_PUBLIC_ALCHEMY_API_KEY` ENV var

2. Open `packages/app/contracts.ts` and update this to use your contract
    - There are several places to update, FYI!

3. Open `packages/app/contracts.ts`
    - Replace mentions of `ExampleNFT` with your app name
    - Update imports to ensure it is using your contract
4. Open `packages/app/pages/index.tsx` and update any imports to point to your new contract
5. Open `packages/app/extractContractError.ts` and update the factory import for your smart contact
6. Open `packages/app/src/Inventory.tsx` and update the contract import

At this point you're on your own! You'll find additional references to `ExampleNFT` related imports throughout the app. As you start to use these components, update them to your needs : ) 

## Customizing the subgraph

Coming Soon ; )