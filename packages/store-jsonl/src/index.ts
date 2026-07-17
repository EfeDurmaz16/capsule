import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CapsuleReceipt, ReceiptStore } from "@capsule-sdk/core";

export interface JsonlReceiptStoreOptions {
  path: string;
  flush?: boolean;
}

export class JsonlReceiptStore implements ReceiptStore {
  private closed = false;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly options: JsonlReceiptStoreOptions) {}

  async ready(): Promise<void> {
    this.assertOpen();
    await mkdir(dirname(this.options.path), { recursive: true });
    const file = await open(this.options.path, "a");
    try {
      if (this.options.flush ?? true) {
        await file.sync();
      }
    } finally {
      await file.close();
    }
  }

  async write(receipt: CapsuleReceipt): Promise<void> {
    this.assertOpen();
    const write = this.pendingWrite.then(() => this.append(receipt));
    this.pendingWrite = write.catch(() => undefined);
    await write;
  }

  async readAll(): Promise<CapsuleReceipt[]> {
    this.assertOpen();
    try {
      const text = await readFile(this.options.path, "utf8");
      const receipts: CapsuleReceipt[] = [];
      for (const [index, line] of text.split("\n").entries()) {
        if (line.trim() === "") {
          continue;
        }
        try {
          receipts.push(JSON.parse(line) as CapsuleReceipt);
        } catch (error) {
          throw new Error(`Invalid JSONL receipt at ${this.options.path}:${index + 1}.`, { cause: error });
        }
      }
      return receipts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pendingWrite;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("JSONL receipt store is closed.");
    }
  }

  private async append(receipt: CapsuleReceipt): Promise<void> {
    await mkdir(dirname(this.options.path), { recursive: true });
    const file = await open(this.options.path, "a");
    try {
      await file.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
      if (this.options.flush ?? true) {
        await file.sync();
      }
    } finally {
      await file.close();
    }
  }
}

export function jsonlReceiptStore(path: string, options: Omit<JsonlReceiptStoreOptions, "path"> = {}): JsonlReceiptStore {
  return new JsonlReceiptStore({ path, ...options });
}
