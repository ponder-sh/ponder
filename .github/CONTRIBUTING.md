# Contributing

Thanks for your interest in contributing to Ponder! Please take a moment to review this document **before submitting a pull request.**

If you want to contribute, but aren't sure where to start, reach out in Ponder's [public telegram group](https://t.me/pondersh) or create a [new discussion](https://github.com/ponder-sh/ponder/discussions).

## Get started

This guide is intended to help you get started with contributing. By following these steps, you will understand the development process and workflow.

- [Fork the repository](#fork-the-repository)
- [Install Node.js and Bun](#install-nodejs-and-bun)
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

## Install Node.js and Bun

Ponder uses [Bun workspaces](https://bun.com/docs/pm/workspaces) to manage multiple projects. You need to install **Node.js v22 or higher** and **Bun v1.4.4 or higher**.

You can run the following commands in your terminal to check your local Node.js and Bun versions:

```bash
node -v
bun -v
```

If the versions are not correct or you don't have Node.js or bun installed, download and follow their setup instructions:

- Install Node.js using [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or from the [official website](https://nodejs.org)
- Install [Bun](https://bun.com/docs/installation)

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Install dependencies

In the root directory, run the following command to install the project's dependencies:

```bash
bun install
```

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Build packages

In the root directory, run the build command:

```bash
bun run build
```

After the build completes, Bun links packages across the project for development. This means that if you run any of the projects in the `examples/` directory, they will use the local version of `ponder`.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Run the test suite

Ponder has two kinds of tests:

- **Unit tests** cover discrete, usually pure and synchronous logic, such as checkpoint encoding, interval math, and filter matching. They use [`bun test`](https://bun.com/docs/test) and need no database, RPC, or network access.
- **Simulation tests** cover behavior across modules, such as sync, indexing, reorgs, and crash recovery, with a deterministic simulation. See [`simulation-test`](../simulation-test/README.md).

### Running unit tests

```bash
# Run the `ponder` unit tests, as CI does
bun --filter ponder test

# Run a single test file
bun --filter ponder test src/utils/interval.test.ts

# Typecheck, including the type-level tests (`*.test-d.ts`)
bun --filter ponder typecheck
```

### Writing unit tests

When adding new features or fixing bugs, add test cases that cover the new or updated behavior.

- Prefer [inline snapshots](https://bun.com/docs/test/snapshots) (`toMatchInlineSnapshot()`) over hand-written expected values. Run the test with `-u` to fill them in, then review the result.
- Don't add unit tests that need Anvil, Postgres, PGlite, the network, or a running Ponder app. Extend the simulation instead.
- Shared fixtures live in `packages/core/src/_test/`.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## Write documentation

Ponder uses [Vocs](https://vocs.dev) and Markdown for the documentation website (located at [`docs`](../docs)). To start the docs website in dev mode, run:

```bash
cd docs

bun run dev
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
2. Create a changeset using `bun changeset`. The changesets CLI will ask you which package is affected (`ponder` or `create-ponder`) and if the change is a patch, minor, or major release.
3. The changesets CLI will generate a Markdown file in `.changeset/` that includes the details you provided. Commit this file to your PR branch (e.g. `git commit -m "chore: changeset"`).
4. When you push this commit to remote, a GitHub bot will detect the changeset and add a comment to your PR with a preview of the changelog.
5. Merge your PR. The changesets Github Action workflow will open (or update) a PR with the title `"chore: version packages"`. The changes in your PR **will not be released** until this PR is merged.

### Prereleases

If you want to do a release before merging code to main, follow the steps above, creating a changeset but stop before merging your pr. Instead, trigger the `snapshot.yml` workflow. This will create a [snapshot](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md) release available on npm with an automatically generated tag in the name (i.e `0.11.4-kjs/drizzle-20250516152012`).

### Releases

When you're ready to release, merge the `"chore: version packages"` PR into `main`. This will trigger the changesets Github Action workflow to build packages, publish to NPM, and create a new GitHub release.

<div align="right">
  <a href="#get-started">&uarr; back to top</a></b>
</div>

## That's it!

If you still have questions, please reach out in Ponder's [public Telegram chat](https://t.me/pondersh) or create a [new discussion](https://github.com/ponder-sh/ponder/discussions).

This guide was adapted from [viem](https://github.com/wagmi-dev/viem/blob/main/.github/CONTRIBUTING.md)'s contribution guide. ❤️
