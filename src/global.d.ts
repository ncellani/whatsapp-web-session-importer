declare function importScripts(...urls: string[]): void;
declare function require(name: string): any;
declare const __d: any;
declare const WAStoreMigrate: any;

interface Window {
  __sessionConnectorLoaded?: {
    active?: boolean;
    runtimeId?: string;
    loadedAt?: number;
  };
  __waWebDumpResult?: any;
}
