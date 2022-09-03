import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";

import { BaseStore, StoreKind } from "./base";

export class SqliteStore implements BaseStore {
  kind = StoreKind.SQLITE;
  db: Sqlite.Database;

  constructor(
    filename = ":memory:",
    options: Sqlite.Options = {
      verbose: logger.debug,
    }
  ) {
    this.db = Sqlite(filename, options);
  }

  async migrate() {
    return;
  }

  async getEntity(key: string, id: string): Promise<any> {
    return;
  }

  async getEntities(key: string, id: string, filter: any): Promise<any> {
    return;
  }

  async setEntity(key: string, id: string, attributes: any): Promise<any> {
    return;
  }

  async removeEntity(key: string, id: string): Promise<void> {
    return;
  }
}
