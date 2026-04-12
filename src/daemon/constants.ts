// Daemon bridge constants.

/** Time limit for the daemon to respond to HELLO with HELLO_ACK. */
export const DAEMON_HANDSHAKE_TIMEOUT_MS = 1000;

/** Consecutive errors before the daemon is killed. */
export const DAEMON_MAX_CONSECUTIVE_ERRORS = 10;

/** Maximum daemon source file size in bytes (UTF-8, LF-normalized). */
export const DAEMON_MAX_SOURCE_BYTES = 4096;

/** PlayerId prefix for daemon players. */
export const DAEMON_PREFIX = 'bot.';
