import { customType, PgCustomColumnBuilder } from "drizzle-orm/pg-core";
import { type Hex, type ByteArray, hexToBytes, bytesToHex } from "viem";

export type HexColumnMode = "hex" | "bytes";
export type HexColumnConfig = {
  mode?: HexColumnMode | undefined;
};

export type PgHexColumnBuilder<config extends HexColumnConfig> =
  PgCustomColumnBuilder<{
    name: string;
    dataType: "custom";
    columnType: "PgCustomColumn";
    data: Hex;
    driverParam: config["mode"] extends "bytes" ? ByteArray : Hex;
    enumValues: undefined;
  }>;

export function hex<config extends HexColumnConfig>(
  ...args: [name?: string, config?: config] | [config?: config]
): PgHexColumnBuilder<config> {
  const name = typeof args[0] === "string" ? (args.shift() as string) : "";
  const config = args.shift() as config;

  return customType<{
    data: Hex;
    driverData: config["mode"] extends "bytes" ? ByteArray : Hex;
  }>({
    dataType() {
      return config?.mode === "bytes" ? "bytea" : "text";
    },
    toDriver(data: Hex): config["mode"] extends "bytes" ? ByteArray : Hex {
      return (config?.mode === "bytes" ? hexToBytes(data) : data) as never;
    },
    fromDriver(
      driverData: config["mode"] extends "bytes" ? ByteArray : Hex
    ): Hex {
      return config?.mode === "bytes"
        ? bytesToHex(driverData as ByteArray)
        : ((driverData as Hex).replace(
            /^0x([0-9a-f](?:[0-9a-f]{2})*)$/i,
            "0x0$1"
          ) as Hex);
    },
  })(name ?? "");
}
