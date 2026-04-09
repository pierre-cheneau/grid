// Public API of the renderer.
//
// External code (the CLI) imports from this file ONLY. Reaching into individual
// modules under `src/render/` is allowed within the renderer but not from outside.

export { tryMaximize } from './ansi.js';
export { renderEpitaph } from './epitaph.js';
export type { EpitaphData } from './epitaph.js';
export { buildFrame } from './grid.js';
export type { Viewport } from './grid.js';
export { introFrame, playIntro, INTRO_DURATION_MS } from './intro.js';
export type { IntroConfig } from './intro.js';
export { createSessionTracker } from './session.js';
export type { SessionStats, SessionTracker } from './session.js';
export { AnsiWriter, cleanupTerminal } from './writer.js';
export type { AnsiWriterOpts } from './writer.js';
