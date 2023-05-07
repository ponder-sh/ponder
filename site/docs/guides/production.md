---
description: "A guide for deploying Ponder apps to production"
---

# Deploy to production

## Railway (recommended)

[Railway](https://railway.app) is currently the best place to deploy Ponder apps. Most Ponder apps cost ~$5 per month, and the deployment process is simple.

<div className="steps-container">

### Sign up or log in to Railway

Connect your GitHub account, and make sure that your Ponder app has been pushed to remote.

### Create a Ponder app service

From the Railway console:

1. Click **New Project** → **Deploy from GitHub repo** and select your repo from the list
2. Click **Add variables**, then add your project's RPC URL (e.g. `PONDER_RPC_URL_1`) and any other environment variables
3. Expose your service to the public internet. Open the **Settings** tab and click **Generate Domain** under **Environment**
4. Set a healthcheck path. In the **Settings** tab, enter `/health` for **Healthcheck Path** under **Deploy**

::: warning
  _Monorepo users:_ You'll need to update your service's **Start Command**. This
  can be found under **Settings** → **Deploy** → **Start Command**. Make sure
  the command runs `ponder start` at the Ponder project root (e.g. `cd
  packages/ponder && pnpm start`).
:::

### Create a Postgres database service

From your project's dashboard, click **New** → **Database** → **Add PostgreSQL**.

After a moment, your Ponder service should redeploy successfully. Check the **Build Logs** and **Deploy Logs** tabs to debug any issues.

</div>

### Zero-downtime deployments

Ponder supports zero-downtime deployments by waiting until all events have been processed before responding as healthy. To support long-running backfills, Ponder apps will begin responding as healthy _before_ the backfill is complete if it exceeds the `maxHealthcheckDuration`. This option defaults 240 seconds (4 minutes), and is configurable using [`options.maxHealthcheckDuration`](/api-reference/ponder-config#options).

If you're using Railway, Ponder will set `maxHealthcheckDuration` automatically according to the **Healthcheck Timeout** specified in your app service settings.

## Other cloud providers

Ponder has not been thoroughly tested on cloud providers other than Railway. However, Ponder apps should work in any environment that supports Node.js and can connect to a Postgres database.
