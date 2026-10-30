/**
 * Minimal `chrome` surface used by the setup_panel lane.
 * Only the calls the popup entry wrapper makes are declared here.
 */

export interface ChromeStorageLocal {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeHubPort {
  postMessage(message: unknown): void;
}

export interface ChromeRuntime {
  connect(connectInfo?: { name?: string }): ChromeHubPort;
}

declare global {
  var chrome:
    | {
        storage: { local: ChromeStorageLocal };
        runtime: ChromeRuntime;
      }
    | undefined;
}

export {};
