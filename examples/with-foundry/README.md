# Foundry Example

This example repo mimics a monorepo with ponder and a foundry dapp. It's intended to be used as a template for new ponder projects that want to integrate both.

## Usage

Start an anvil local node:

```shell
anvil --block-time 1
```

Compile contracts:

```shell
cd foundry && forge build
```

Run script to deploy contracts and generate some events:

```shell
cd foundry && forge script script/Deploy.s.sol --broadcast --fork-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Generate abis:

```shell
pnpm wagmi generate
```

Start ponder app:

```shell
pnpm ponder dev
```

## More

Follow the [Ponder docs](https://ponder.sh/docs/advanced/foundry) to learn more on how to use Ponder with Foundry.
