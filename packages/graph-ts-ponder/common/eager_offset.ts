// # What is this file?
// This file is a "hack" to allow global variables in subgraphs and
// on this library (`graph-ts`).
//
// # Why is it needed?
// It's necessary because of one of the features of the AssemblyScript
// compiler we use, the stub runtime.
//
// The problem happens because we call the stub runtime allocation
// (`__alloc`) directly on Rust side (`graph-node`), and that doesn't
// trigger some AssemblyScript aspects of the code.
//
// If you take a look at the stub runtime's code, you'll see that the
// `__alloc` function uses a variable named `offset` tagged as `lazy`.
// Like said above, since we call it on Rust side, this variable is not
// "triggered" to be used, then it's declared below the `__alloc` call
// in the compiled WASM code.
//
// That makes the `graph-node` WASM runtime break because of this out
// of order variable usage.
//
// # How does this fix the issue?
// The way this workaround works is by calling the `__alloc` function
// before everything in the AssemblyScript side. This makes the `offset`
// `lazy` variable be eagerly evaluated when the mappings are compiled
// (since they always import `graph-ts`).
//
// So when we're on Rust side calling `__alloc` it will be fine, because
// the `offset` is declared before call (order fixed because of this file).
//
// The 0 argument to the function call is just because we need no memory
// to be allocated.
//
// # IMPORTANT
// This should be imported in EVERY file which uses external namespaces (`graph-node` host-exports code),
// just to make sure no one imports a file directly and gets an error on global variables.
//
// # Reference
// - Runtimes in AS: https://www.assemblyscript.org/garbage-collection.html#runtime-variants
// - `offset` variable in question: https://github.com/AssemblyScript/assemblyscript/blob/f4091b8f3b6b029d30cd917cf84d97421faadeeb/std/assembly/rt/stub.ts#L9
// @ts-ignore We do not want to expose __alloc, hence why we just ignore the error
__alloc(0)
