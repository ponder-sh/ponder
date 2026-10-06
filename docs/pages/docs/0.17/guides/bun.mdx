# Bun [Running Ponder with Bun]

[Bun](https://bun.sh) is a toolkit for modern JavaScript and TypeScript applications. Bun includes a **runtime** (alternative to Node.js), a **package manager** (alternative to `npm`, `pnpm`, and `yarn`), and more.

Ponder supports Bun as both a runtime and package manager.

## New project

To create a new project using Bun, just use `bun --bun` to run the `create-ponder` CLI tool. [Read more](/docs/api-reference/ponder/cli). This will create a new project directoty using the Bun package manager and runtime.

```bash [shell]
bun --bun create ponder {...options}
```

## Existing project

::::steps

### Migrate to Bun package manager

First, follow [this guide](https://bun.com/docs/guides/install/from-npm-install-to-bun-install) to migrate your repository to Bun's package manager.

### Update `package.json` scripts

Next, update the scripts in `package.json` to use `bun --bun` instead of the bare `ponder` CLI entrypoint to opt-in to Bun's runtime.

```json [package.json]
"scripts": {
  "dev": "ponder dev", // [!code --]
  "start": "ponder start", // [!code --]
  "codegen": "ponder codegen", // [!code --]
  "dev": "bun --bun ponder dev", // [!code ++]
  "start": "bun --bun start", // [!code ++]
  "codegen": "bun --bun ponder codegen", // [!code ++]
  "lint": "eslint .",
  "typecheck": "tsc"
},
```

:::info
Without the `--bun` flag, the Bun script runner runs the `ponder` command in Node.js to respect the `#!/usr/bin/env node` shebang, which is required by other script runners. [Read more](https://github.com/oven-sh/bun/issues/9346).
:::

### Run `bun dev` or `bun start`

That's it! Now, the `dev` and `start` commands will always use the Bun runtime.

```bash [shell]
bun dev
```

::::


## Known limitations

If you encounter an issue with Ponder that might be caused by Bun, please [open a GitHub issue](https://github.com/ponder-sh/ponder/issues).

* When using Bun, the `/metrics` endpoint omits all default Node.js Prometheus metrics (e.g. `nodejs_heap_space_size_available_bytes` and all other metrics prefixed with `nodejs_` or `process_`). [Read more](https://github.com/siimon/prom-client?tab=readme-ov-file#default-metrics).
