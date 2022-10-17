# Getting started

### I'm replacing a Graph Protocol subgraph

Ponder is an alternative to the Graph Protocol that aims to be more developer-friendly. You can quickly migrate an existing subgraph repository to Ponder using the `create-ponder-app` CLI tool.

#### 1. Run `npx create-ponder-app`

This command will create a project folder called `ponder` in your current working directory. Include the `--from-subgraph` option to bootstrap your project using an existing Graph Protocol subgraph.

```
npx create-ponder-app@latest --from-subgraph ./subgraph-directory
# or
yarn create ponder-app --from-subgraph ./subgraph-directory
# or
pnpm create ponder-app --from-subgraph ./subgraph-directory
```

#### 2. Start the development server

```
cd ponder
```

```
npm run dev
# or
yarn dev
# or
pnpm run dev
```

The dev server prints logs to help you debug any configuration issues or errors. The server automatically reloads whenever you save changes in any project file.

### 2) I'm starting a new project

#### 1. Run `npx create-ponder-app`

This command will create a project folder called `ponder` in your current working directory. The project will contain examples for a simple ERC721 NFT contract.

```
npx create-ponder-app@latest
# or
yarn create ponder-app
# or
pnpm create ponder-app
```

#### 2. Start the development server

```
cd ponder
```

```
npm run dev
# or
yarn dev
# or
pnpm run dev
```
