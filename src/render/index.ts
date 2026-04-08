// Public API of the renderer.
//
// External code (the CLI) imports from this file ONLY. Reaching into individual
// modules under `src/render/` is allowed within the renderer but not from outside.

export { buildFrame } from './grid.js';
export type { Viewport } from './grid.js';
export { AnsiWriter, cleanupTerminal } from './writer.js';
export type { AnsiWriterOpts } from './writer.js';
