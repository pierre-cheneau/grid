// Transport interface for daemon communication.
//
// Both subprocess (child_process) and worker (worker_threads) implementations
// satisfy this interface. The bridge doesn't care which transport is in use.

export interface DaemonTransport {
  /** Send a JSON line to the daemon. */
  send(line: string): void;
  /** Register handler for lines received from the daemon. */
  onLine(cb: (line: string) => void): void;
  /** Register handler for daemon exit or crash. */
  onExit(cb: (code: number | null, error?: string) => void): void;
  /** Kill the daemon process/worker. */
  kill(): void;
}
