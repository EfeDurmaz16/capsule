import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CapsuleReceipt, ReceiptStore } from "@capsule/core";

export interface JsonlReceiptStoreOptions {
  path: string;
}

export class JsonlReceiptStore implements ReceiptStore {
  constructor(private readonly options: JsonlReceiptStoreOptions) {}

  async write(receipt: CapsuleReceipt): Promise<void> {
    await mkdir(dirname(this.options.path), { recursive: true });
    await appendFile(this.options.path, `${JSON.stringify(receipt)}\n`, "utf8");
  }

  async readAll(): Promise<CapsuleReceipt[]> {
    try {
      const text = await readFile(this.options.path, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CapsuleReceipt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export function jsonlReceiptStore(path: string): JsonlReceiptStore {
  return new JsonlReceiptStore({ path });
}
