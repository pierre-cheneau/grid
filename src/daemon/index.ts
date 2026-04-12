// Public API of the daemon module.

export { DaemonBridge } from './bridge.js';
export type { DaemonBridgeConfig, DaemonBridgeDeps } from './bridge.js';
export { daemonColorSeed, daemonPlayerId } from './id.js';
export { createSubprocessTransport } from './subprocess-transport.js';
export type { DaemonTransport } from './transport.js';
export type { DaemonCmd, DaemonHelloAck, DaemonTick } from './types.js';
export {
  DAEMON_HANDSHAKE_TIMEOUT_MS,
  DAEMON_MAX_CONSECUTIVE_ERRORS,
  DAEMON_MAX_SOURCE_BYTES,
  DAEMON_PREFIX,
} from './constants.js';
