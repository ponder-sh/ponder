The files in this directory were copied from `wagmi`. This directory exports a generic type `AbitypedEthersContract` that `@ponder/core` re-exports. This generic type is used in the `contracts.ts` file that Ponder generates and handler files import.

In the future, I hope/expect to remove all of this, remove `@ponder/core`'s dependency on `abitype`, and add `abitype` as a dev dependency for Ponder projects.
