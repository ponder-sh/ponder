# Foundry Example

This is an example monorepo Ponder and Foundry dapp. It's intended to be used as a template for new ponder projects that want to integrate both.

For more information, read the Foundry [integration guide](https://ponder.sh/docs/advanced/foundry).

## Usage

Start an Anvil local node:

```shell
anvil --block-time 1
```

Compile contracts:

```shell
forge build
```

Run a Foundry script to deploy contracts and generate some logs:

```shell
forge script script/Deploy.s.sol --broadcast --fork-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Generate ABIs:

```shell
pnpm wagmi generate
```

Start the Ponder development server:

```shell
pnpm ponder dev
```