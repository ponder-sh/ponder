# Simulation Test

A deterministic simulation of Ponder: a seed generates the chains, RPC providers, apps, and faults, and the same seed reproduces the same run.

Requires Bun and a Postgres server in `DATABASE_URL` (no database name; defaults to `postgresql://postgres@localhost:5432`).

```sh
bun run build # the generated apps import `ponder`
cd simulation-test
bun run test                             # a random seed
SEED=abc bun run test                    # reproduce a seed
SEED=abc bun run test --log-level debug  # with logs
SEED=abc bun run test --plan             # print the plan
```

Each simulation runs for a planned duration of virtual time. Chains mine a block every block time until then, and the runs of the apps stop at their planned times, gracefully or like a killed process. An app that exits before its run stops fails the simulation.

Each simulation recreates a database `sim_<seed>`, dropped on success and kept on failure, and writes its apps to `.apps/<seed>/`.
