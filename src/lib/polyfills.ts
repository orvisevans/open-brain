// Node-global polyfills for browser-only libraries that predate web APIs.
//
// isomorphic-git (1.37.x) is the only current consumer — its index bundle uses
// `Buffer.from/alloc/concat` at several points in index/pack/tree handling. The
// upstream library works in browsers only if `globalThis.Buffer` is set before
// any of those code paths run. See IMPLEMENTATION-PLAN §10 Decision Log.
//
// This module is side-effect only. Import it (bare `import '$lib/polyfills';`)
// at the top of any module that pulls in isomorphic-git. Keep it lean — every
// byte here ships to every user whose route touches sync.

// The npm `buffer` package is the browser polyfill; `node:buffer` would resolve
// to the Node built-in and Vite externalizes it, leaving `Buffer` undefined at
// runtime (and crashing any route that imports this module with a 500).
// eslint-disable-next-line unicorn/prefer-node-protocol -- browser polyfill, not Node built-in
import { Buffer } from 'buffer';

interface BufferGlobal {
  Buffer?: typeof Buffer;
}
const globalScope = globalThis as unknown as BufferGlobal;

globalScope.Buffer ??= Buffer;
