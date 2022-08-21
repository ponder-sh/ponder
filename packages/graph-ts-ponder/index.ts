// Side-effect to evaluate eagerly the offset of stub AS runtime
import './common/eager_offset'
// Arweave support
export * from './chain/arweave'
// Ethereum support
export * from './chain/ethereum'
// NEAR support
export * from './chain/near'
// Cosmos support
export * from './chain/cosmos'
// Regular re-exports
export * from './common/numbers'
export * from './common/collections'
export * from './common/value'
export * from './common/conversion'
export * from './common/json'
export * from './common/datasource'

import { Bytes, ByteArray, Entity } from './common/collections'
import { Value } from './common/value'

/**
 * Host store interface.
 */
export declare namespace store {
  function get(entity: string, id: string): Entity | null
  function set(entity: string, id: string, data: Entity): void
  function remove(entity: string, id: string): void
}

/** Host IPFS interface */
export declare namespace ipfs {
  function cat(hash: string): Bytes | null
  function map(hash: string, callback: string, userData: Value, flags: string[]): void
}

export namespace ipfs {
  export function mapJSON(hash: string, callback: string, userData: Value): void {
    ipfs.map(hash, callback, userData, ['json'])
  }
}

/** Host crypto utilities interface */
export declare namespace crypto {
  function keccak256(input: ByteArray): ByteArray
}

/**
 * Special function for ENS name lookups, not meant for general purpose use.
 * This function will only be useful if the graph-node instance has additional
 * data loaded **
 */
export declare namespace ens {
  function nameByHash(hash: string): string | null
}

function format(fmt: string, args: string[]): string {
  let out = ''
  let argIndex = 0
  for (let i: i32 = 0, len: i32 = fmt.length; i < len; i++) {
    if (
      i < len - 1 &&
      fmt.charCodeAt(i) == 0x7b /* '{' */ &&
      fmt.charCodeAt(i + 1) == 0x7d /* '}' */
    ) {
      if (argIndex >= args.length) {
        throw new Error('Too few arguments for format string: ' + fmt)
      } else {
        out += args[argIndex++]
        i++
      }
    } else {
      out += fmt.charAt(i)
    }
  }
  return out
}

// Host interface for logging
export declare namespace log {
  // Host export for logging, providing basic logging functionality
  export function log(level: Level, msg: string): void
}

export namespace log {
  export enum Level {
    CRITICAL = 0,
    ERROR = 1,
    WARNING = 2,
    INFO = 3,
    DEBUG = 4,
  }

  /**
   * Logs a critical message that terminates the subgraph.
   *
   * @param msg Format string a la "Value = {}, other = {}".
   * @param args Format string arguments.
   */
  export function critical(msg: string, args: Array<string>): void {
    log.log(Level.CRITICAL, format(msg, args))
  }

  /**
   * Logs an error message.
   *
   * @param msg Format string a la "Value = {}, other = {}".
   * @param args Format string arguments.
   */
  export function error(msg: string, args: Array<string>): void {
    log.log(Level.ERROR, format(msg, args))
  }

  /** Logs a warning message.
   *
   * @param msg Format string a la "Value = {}, other = {}".
   * @param args Format string arguments.
   */
  export function warning(msg: string, args: Array<string>): void {
    log.log(Level.WARNING, format(msg, args))
  }

  /** Logs an info message.
   *
   * @param msg Format string a la "Value = {}, other = {}".
   * @param args Format string arguments.
   */
  export function info(msg: string, args: Array<string>): void {
    log.log(Level.INFO, format(msg, args))
  }

  /** Logs a debug message.
   *
   * @param msg Format string a la "Value = {}, other = {}".
   * @param args Format string arguments.
   */
  export function debug(msg: string, args: Array<string>): void {
    log.log(Level.DEBUG, format(msg, args))
  }
}
