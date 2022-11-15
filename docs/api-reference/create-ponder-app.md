# Create Ponder app

The easist way to get started with Ponder is `create-ponder-app`. This CLI tool enables you to smoothly migrate your Graph Protocol subgraph to Ponder, or start a new project from scratch.

```shell
npx create-ponder-app@latest
```

## Options

`create-ponder-app` offers the following options:

- **--from-subgraph [path/to/subgraph]**
  Bootstrap the project from an existing Graph Protocol subgraph repository.
- **--from-etherscan [etherscan-url]**
  Bootstrap the project from an Etherscan contract page. Mutually exclusive with the _--from-subgraph_ option.
- **--dir [path/to/directory]**
  Create the Ponder project in the specified directory. Defaults to `.`.
