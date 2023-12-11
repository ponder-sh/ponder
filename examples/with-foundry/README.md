# Foundry Example

This example repo mimics a monorepo with ponder and a foundry dapp. It's intended to be used as a template for new ponder projects that want to integrate both.

## Guide

Follow the [Ponder docs](https://ponder.sh) to learn more on how to use Ponder with Foundry.

Ensure you have Ponder installed as well as `foundry`. You will also need to install the example packages with:

```shell
pnpm install && cd ponder && pnpm install
```

And then install the foundry packages in the `/contracts`:

```shell
# In the `/contracts` directory
forge install
```

## Usage

There are some handy scripts in `package.json` to help you get started with this example. Open two terminal windows and run the following commands in each which starts an anvil server and ponder service respectively:

```shell
pnpm run start:anvil
```

```shell
pnpm run dev:ponder
```

Next, you'll want to open a third terminal window and deploy the contracts:

```shell
pnpm run deploy
```

After the contracts are deployed, you can run the following command to generate a single event:

```shell
pnpm run generate:event
```

## Developing

If you'd like to develop the contracts further, make changes as required in `contracts/` and run the following command to recompile the contracts:

```shell
pnpmn run generate:abi
```

This uses `wagmi-cli` to generate the ABI typescript files. Before deploying, you'll need to restart anvil and redeploy the contracts. After that, you can reload the ponder service using a dev only route:

```shell
curl -X POST http://localhost:42069/admin/reload?chainId=31337
```

This assumes you're using the default port and chainId. Replace the port and chainId if you're using different values.
