# Create Ponder app

The easist way to get started with Ponder is `create-ponder-app`. This CLI tool enables you to smoothly migrate your Graph Protocol subgraph to Ponder, or start a new project from scratch.

```shell
npx create-ponder-app@latest
# or
yarn create ponder-app
# or
pnpm create ponder-app
```

## Options

`create-ponder-app` offers the following options:

- **--from-subgraph [path-to-subgraph]** - Bootstrap the project using an existing Graph Protocol subgraph repository.
- **--dir [path-to-directory]** - Create the Ponder project in the specified directory. Defaults to `.`.
- **--with-docker-compose** - Include a `docker-compose.yml` file suitable for production deployments.
- **--with-render-yaml** - Include a `render.yml` file for easy deployment to [Render](https://render.com/).
