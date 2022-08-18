# NOTE: None of this exists yet. Stay tuned!

# ponder

A local development server for building APIs on top of blockchain data.

### Features

- Fully compatible with existing subgraphs (The Graph) 🟨
- Hot reload on changes to all project files ✅
- Support for any EVM-based blockchain (just need an RPC URL) ✅
- Caches logs locally for faster reindexing ✅

### Quickstart

#### I have an existing subgraph

1. Install `@ponder/ponder` as a dev dependency:

`npm install -D @ponder/ponder`

2. Add a script to your `package.json`:

`"dev": "ponder dev"`

3. Start the development server:

`npm run dev`

The console will display useful logs and help you handle any errors.

#### I'm starting a new project

To create a new ponder project, run

```
npx create-ponder-app
yarn create ponder-app
pnpm create ponder-app
```

and respond to the prompts accordingly. This will generate a (tiny!) project directory to get you started. Open up `ponder.config.js` and follow the trail of comments from there!

### Docs

Coming soon!

### Packages

- `@ponder/ponder`
- `@ponder/create-ponder`
- `examples`

### About

#### Goals

- Be the best local development tool for blockchain app developers
- Work seamlessly alongside frontend frameworks like Next.js

#### Non-goals

- Efficiently index massive amounts of data
- Serve analytics queries/workloads
