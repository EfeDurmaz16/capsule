import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CapsuleReceipt, ReceiptStore } from "@capsule/core";

export interface SqliteReceiptStoreOptions {
  path: string;
  tableName?: string;
}

interface ReceiptRow {
  receipt_json: string;
}

function assertSafeTableName(tableName: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error("SQLite receipt store tableName must be an identifier containing only letters, numbers, and underscores.");
  }
  return tableName;
}

export class SqliteReceiptStore implements ReceiptStore {
  private readonly db: DatabaseSync;
  private readonly tableName: string;

  constructor(options: SqliteReceiptStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true });
    this.tableName = assertSafeTableName(options.tableName ?? "capsule_receipts");
    this.db = new DatabaseSync(options.path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      adapter TEXT NOT NULL,
      capability_path TEXT NOT NULL,
      support_level TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${this.tableName}_provider_idx ON ${this.tableName} (provider)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${this.tableName}_type_idx ON ${this.tableName} (type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${this.tableName}_started_at_idx ON ${this.tableName} (started_at)`);
  }

  write(receipt: CapsuleReceipt): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (
          id,
          type,
          provider,
          adapter,
          capability_path,
          support_level,
          started_at,
          finished_at,
          receipt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receipt.id,
        receipt.type,
        receipt.provider,
        receipt.adapter,
        receipt.capabilityPath,
        receipt.supportLevel,
        receipt.startedAt,
        receipt.finishedAt,
        JSON.stringify(receipt)
      );
  }

  readAll(): CapsuleReceipt[] {
    return this.db
      .prepare(`SELECT receipt_json FROM ${this.tableName} ORDER BY started_at ASC, id ASC`)
      .all()
      .map((row) => JSON.parse((row as unknown as ReceiptRow).receipt_json) as CapsuleReceipt);
  }

  close(): void {
    this.db.close();
  }
}

export function sqliteReceiptStore(path: string, options: Omit<SqliteReceiptStoreOptions, "path"> = {}): SqliteReceiptStore {
  return new SqliteReceiptStore({ path, ...options });
}
