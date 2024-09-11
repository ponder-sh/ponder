# Contributing

Thanks for your interest in contributing to Ponder! Please take a moment to review this document **before submitting a pull request.**

If you want to contribute, but aren't sure where to start, reach out in Ponder's [public telegram group](https://t.me/ponder_sh) or create a [new discussion](https://github.com/ponder-sh/ponder/discussions).

## Get started

This guide is intended to help you get started with contributing. By following these steps, you will understand the development process and workflow.

- [Fork the repository](#fork-the-repository)
- [Install Node.js and pnpm](#install-nodejs-and-pnpm)
- [Install Foundry](#install-foundry)
- [Install dependencies](#install-dependencies)
- [Build packages](#build-packages)
- [Run the test suite](#run-the-test-suite)
- [Write documentation](#write-documentation)
- [Submit a pull request](#submit-a-pull-request)
- [Versioning and releases](#versioning-and-releases)
- [That's it!](#thats-it)

<br>

---

<br>

## Fork the repository

To start contributing to the project, [create a fork](https://github.com/ponder-sh/ponder/fork) and clone it to your machine using `git clone`.

Or, use the [GitHub CLI](https://cli.github.com) to create a fork and clone it in one command:

```bash
gh repo fork ponder-sh/ponder --clone
```

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Install Node.js and pnpm

Ponder uses [pnpm workspaces](https://pnpm.io/workspaces) to manage multiple projects. You need to install **Node.js v18 or higher** and **pnpm v9 or higher**.

You can run the following commands in your terminal to check your local Node.js and pnpm versions:

```bash
node -v
pnpm -v
```

If the versions are not correct or you don't have Node.js or pnpm installed, download and follow their setup instructions:

- Install Node.js using [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or from the [official website](https://nodejs.org)
- Install [pnpm](https://pnpm.io/installation)

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Install Foundry

Ponder uses [Foundry](https://book.getfoundry.sh/) for testing. The test suite uses local [Anvil](https://github.com/foundry-rs/foundry/tree/master/anvil) instances via [Anvil.js](https://github.com/wagmi-dev/anvil.js) to run isolated, concurrent tests against forks of Ethereum mainnet.

Install Foundry (and Anvil) using the following command:

```bash
curl -L https://foundry.paradigm.xyz | bash
```

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Install dependencies

In the root directory, run the following command to install the project's dependencies:

```bash
pnpm install
```

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Build packages

In the root directory, run the build command:

```bash
pnpm build
```

After the build completes, pnpm links packages across the project for development. This means that if you run any of the projects in the `examples/` directory, they will use the local version of `@ponder/core`.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Run the test suite

### Running tests

The test suite uses [vitest](https://vitest.dev/guide) in concurrent mode as a test runner.

Herea are some commands to get you started.

```bash
# Run all tests in watch mode
pnpm test

# Run a single test file
pnpm test /path/to/file.test.ts
```

When adding new features or fixing bugs, it's important to add test cases to cover any new or updated behavior.

### Run tests against Postgres

By default, the test suite runs against in-memory SQLite databases which mimic Ponder development environments. Unless you are specifically testing Postgres behavior, you don't need to run tests against Postgres locally and can instead rely on CI to catch any regressions.

To run the test suite against Postgres, set the `DATABASE_URL` env var in `packages/core/.env.local`.

```bash
DATABASE_URL=postgres://{username}@localhost:5432/{username}
```

Any test-friendly Postgres server will do. MacOS users can download [Postgres.app](https://postgresapp.com/documentation/), a simple way to get a Postgres server running on your local machine.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Write documentation

Ponder uses [Nextra](https://nextra.site) and Markdown for the documentation website (located at [`docs`](../docs)). To start the docs website in dev mode, run:

```bash
cd docs

pnpm dev
```

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Submit a pull request

When you're ready to submit a pull request, follow these naming conventions:

- Pull request titles use the [imperative mood](https://en.wikipedia.org/wiki/Imperative_mood) (e.g., `Add something`, `Fix something`).
- [Changesets](#versioning) use past tense verbs (e.g., `Added something`, `Fixed something`).

When you submit a pull request, a GitHub Action will automatically lint, build, and test your changes. If you see an ❌, it's most likely a problem with your code. Inspect the logs through the GitHub Actions UI to find the cause.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Versioning and releases

Ponder uses [changesets](https://github.com/changesets/changesets) to manage package versioning and NPM releases.

Ponder is still in alpha, so all changes should be marked as a patch.

### Changesets workflow

1. Write a PR that includes a public API change or bug fix.
2. Create a changeset using `pnpm changeset`. The changesets CLI will ask you which package is affected (`@ponder/core` or `create-ponder`) and if the change is a patch, minor, or major release.
3. The changesets CLI will generate a Markdown file in `.changeset/` that includes the details you provided. Commit this file to your PR branch (e.g. `git commit -m "chore: changeset"`).
4. When you push this commit to remote, a GitHub bot will detect the changeset and add a comment to your PR with a preview of the changelog.
5. Merge your PR. The changesets Github Action workflow will open (or update) a PR with the title `"chore: version packages"`. The changes in your PR **will not be released** until this PR is merged.

### Releases

When you're ready to release, merge the `"chore: version packages"` PR into `main`. This will trigger the changesets Github Action workflow to build packages, publish to NPM, and create a new GitHub release.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## That's it!

If you still have questions, please reach out in Ponder's [public telegram group](https://t.me/ponder_sh) or create a [new discussion](https://github.com/ponder-sh/ponder/discussions).

This guide was adapted from [viem](https://github.com/wagmi-dev/viem/blob/main/.github/CONTRIBUTING.md)'s contribution guide. ❤️
