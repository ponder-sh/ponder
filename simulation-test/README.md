# Simulation Testing

## Usage

### Setup environment

Create an `env.local` file using `.env.example` as a template. The `DATABASE_URL` should not include a database (i.e. `postgres://kylescott@localhost:5432`).

To setup a local database from scratch, there are two steps.

First, run migrations to create metadata and rpc cache tables used by all apps / tests.

```pnpm migrate```

Then, create the "ground-truth" tables for an app.

```pnpm create:app [app id]```

### Run test

```pnpm test [app id]```

Specify a seed for reproducing an exact test input.

```SEED=[seed] pnpm test [app id]```

CLI flags are supported and passed through to Ponder.

```pnpm test [app id] -- -v```

## Notable seeds

b821add56458bb3507f5fdde0a06bd20bb50f4b1cb89e014f6d19d8638438d23
75ae0bbb7a3614c3a5a6e2b889f6a03d805a68637cb18244394f8460ce297f5e
4909f7589535ffee494dc7e5433392949bcfcc1a270b3776a58199dd66392869
20ad4bce62c7765e45a045b40f66b97c39017a8e871d9ece7018706b85d3077b
f9ecd61178de5a6b2fcdee26f836dd23ed8ffd8b3d50f33f72ee62e84acf97ef
d482923c1a77cdf50ee254ddcc4b677018796fe026a579c49f8cff9f7b9f6f89
fb0b04ef7e6c4675fdfea6e86ecce4e046dc7af754ec98c3150c717dd23b51f3
f6ed9fe614a4e988f7274f566a5a98d61028de8f1de5428b9398b0b195177438