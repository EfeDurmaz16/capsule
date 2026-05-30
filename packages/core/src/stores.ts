import type { CapsuleReceipt } from "./types.js";

export type ReceiptPersistenceMode = "best-effort" | "required";

export interface ReceiptStore {
  ready?(): Promise<void> | void;
  write(receipt: CapsuleReceipt): Promise<void> | void;
}

export class MemoryReceiptStore implements ReceiptStore {
  readonly receipts: CapsuleReceipt[] = [];

  write(receipt: CapsuleReceipt): void {
    this.receipts.push(receipt);
  }
}
