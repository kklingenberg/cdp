// Type definitions for tail-file 1.4.15
// Project: cdp
// Definitions by: Kai Klingenberg

declare module "tail-file" {
  import { EventEmitter } from "events";

  export = Tail;

  interface Options {
    startPos?: "start" | "end" | number;
    force?: boolean;
    sep?: string | RegExp;
    encoding?:
      | "utf8"
      | "utf16le"
      | "hex"
      | "ascii"
      | "base64"
      | "latin1"
      | "base64url";
  }

  declare class Tail extends EventEmitter {
    constructor(
      filename: string,
      options?: Options,
      cb?: (line: string) => void
    );
    start(filename?: string): void;
    startP(filename?: string): Promise<boolean>;
    stop(): Promise<boolean>;
  }
}
