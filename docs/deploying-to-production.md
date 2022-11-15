# Deploying to production

## Render

`create-ponder-app` automatically generates a `render.yaml` file which enables zero-config deployment to [Render](https://render.com).

Steps to deploy to Render:

1. Confirm that your `ponder.config.js` and `render.yaml` look similar to these:

```js
// ponder.config.js

module.exports = {
    database: {
        kind: "postgres",
        connectionString: process.env.POSTGRES_URL,
    },
    ...
}
```

```yml
# render.yaml

services:
  - type: web
    name: my-ponder-app
    env: node
    buildCommand: pnpm install
    startCommand: pnpm run start
    envVars:
      - key: POSTGRES_URL
        fromDatabase:
          name: my-ponder-db
          property: connectionString
      - key: PONDER_RPC_URL_1
        sync: false

databases:
  - name: my-ponder-db
    postgresMajorVersion: 14
```

2. Sign up for Render and connect your GitHub or GitLab account.
3. Go to the dashboard, click **New +**, then click **Blueprint**.
4. Find your Ponder app in the list of repositories and click **Connect**.
5. Give your service group a name, then click **Create New Resources**.
6. Done!

## Other cloud providers (Railway, AWS, etc)

Ponder has not been thoroughly tested on cloud providers other than Render. However, Ponder apps should work in any environment that supports Node.js and can connect to a Postgres database. If you're attempting to host a Ponder app elsewhere, the sample `render.yaml` above might be helpful.
