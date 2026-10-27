import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { CapsuleReceipt, ReceiptStore } from "@capsule-sdk/core";

/** Default largest accepted JSONL line (16 MiB), counted in bytes without the line break. */
export const DEFAULT_MAX_JSONL_LINE_BYTES = 16 * 1024 * 1024;

const readChunkBytes = 1024 * 1024;

export interface JsonlReceiptStoreOptions {
  path: string;
  flush?: boolean;
  /**
   * Largest line `iterate` and `readAll` accept, in bytes. A longer line fails the read with its line
   * number instead of growing memory without bound. Defaults to DEFAULT_MAX_JSONL_LINE_BYTES.
   */
  maxLineBytes?: number;
}

export interface JsonlReadOptions {
  /** Overrides the store's maxLineBytes for this read. */
  maxLineBytes?: number;
}

export class JsonlReceiptStore implements ReceiptStore {
  private closed = false;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly options: JsonlReceiptStoreOptions) {
    if (options.maxLineBytes !== undefined) assertMaxLineBytes(options.maxLineBytes);
  }

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

  /**
   * Reads receipts one line at a time, in file order, without holding the whole file. Only one read chunk
   * (1 MiB), the current line (at most maxLineBytes) and the receipt being yielded stay in memory, plus
   * whatever the caller keeps. A regular file is read up to its size when iteration started, as readFile
   * does, so lines appended later are not returned. Blank lines are skipped, a missing file yields
   * nothing, and a line that is not JSON or is longer than maxLineBytes throws with its path and 1-based
   * line number. Stopping early (break, return or a throw in the loop body) closes the file.
   */
  async *iterate(options: JsonlReadOptions = {}): AsyncGenerator<CapsuleReceipt, void, undefined> {
    this.assertOpen();
    const lines = await JsonlLineReader.open(this.options.path, this.maxLineBytes(options));
    if (!lines) return;
    try {
      while (await lines.fill()) {
        for (let line = lines.next(); line !== undefined; line = lines.next()) {
          const receipt = lines.parse(line);
          if (receipt !== undefined) yield receipt;
        }
      }
      const last = lines.finish();
      const receipt = last === undefined ? undefined : lines.parse(last);
      if (receipt !== undefined) yield receipt;
    } finally {
      await lines.close();
    }
  }

  /**
   * Reads every receipt into an array, with the same reader, order, errors and line numbers as iterate.
   * It collects without an asynchronous step per receipt, so it is not slower than reading the whole file.
   */
  async readAll(options: JsonlReadOptions = {}): Promise<CapsuleReceipt[]> {
    this.assertOpen();
    const receipts: CapsuleReceipt[] = [];
    const lines = await JsonlLineReader.open(this.options.path, this.maxLineBytes(options));
    if (!lines) return receipts;
    try {
      while (await lines.fill()) lines.drainInto(receipts);
      const last = lines.finish();
      const receipt = last === undefined ? undefined : lines.parse(last);
      if (receipt !== undefined) receipts.push(receipt);
    } finally {
      await lines.close();
    }
    return receipts;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pendingWrite;
  }

  private maxLineBytes(options: JsonlReadOptions): number {
    const maxLineBytes = options.maxLineBytes ?? this.options.maxLineBytes ?? DEFAULT_MAX_JSONL_LINE_BYTES;
    assertMaxLineBytes(maxLineBytes);
    return maxLineBytes;
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

/**
 * Splits a file into lines one chunk at a time. Each chunk is decoded once (a multi-byte character cut by
 * a chunk edge is completed by the next chunk) and lines are sliced from it; only the unfinished tail of a
 * line is carried to the next chunk.
 */
class JsonlLineReader {
  private readonly chunk = Buffer.allocUnsafe(readChunkBytes);
  private readonly decoder = new StringDecoder("utf8");
  private text = "";
  private position = 0;
  // Start of the current line when it began in an earlier chunk.
  private pending = "";
  private lineNumber = 0;

  private constructor(
    private readonly file: FileHandle,
    private readonly path: string,
    private readonly maxLineBytes: number,
    private remaining: number
  ) {}

  static async open(path: string, maxLineBytes: number): Promise<JsonlLineReader | undefined> {
    let file: FileHandle;
    try {
      file = await open(path, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stat = await file.stat();
      // A regular file is read up to its size now, like readFile; anything else until end of file.
      return new JsonlLineReader(file, path, maxLineBytes, stat.isFile() ? stat.size : Number.POSITIVE_INFINITY);
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  /** Reads and decodes the next chunk. False at the end of the file. */
  async fill(): Promise<boolean> {
    if (this.position < this.text.length) {
      // The unfinished tail of the previous chunk joins the pending line. A UTF-8 byte is at most one
      // UTF-16 unit, so more units than maxLineBytes is already too long, and memory stays bounded.
      this.pending += this.text.slice(this.position);
      if (this.pending.length > this.maxLineBytes) throw this.tooLong();
    }
    this.text = "";
    this.position = 0;
    if (this.remaining <= 0) return false;
    const { bytesRead } = await this.file.read(this.chunk, 0, Math.min(readChunkBytes, this.remaining), null);
    if (bytesRead === 0) return false;
    this.remaining -= bytesRead;
    this.text = this.decoder.write(this.chunk.subarray(0, bytesRead));
    return true;
  }

  /** Next complete line of the current chunk, or undefined when the chunk has no further line break. */
  next(): string | undefined {
    const end = this.text.indexOf("\n", this.position);
    if (end === -1) return undefined;
    let line = this.text.slice(this.position, end);
    this.position = end + 1;
    if (this.pending !== "") {
      line = this.pending + line;
      this.pending = "";
    }
    this.assertWithinLimit(line);
    return line;
  }

  /**
   * Parses every complete line of the current chunk into `receipts`: next and parse in one loop over
   * local variables, which a first call runs noticeably faster than a method call per line.
   */
  drainInto(receipts: CapsuleReceipt[]): void {
    if (this.pending !== "") {
      const first = this.next();
      if (first === undefined) return;
      const receipt = this.parse(first);
      if (receipt !== undefined) receipts.push(receipt);
    }
    const text = this.text;
    const maxLineBytes = this.maxLineBytes;
    let position = this.position;
    let lineNumber = this.lineNumber;
    try {
      for (let end = text.indexOf("\n", position); end !== -1; end = text.indexOf("\n", position)) {
        const line = text.slice(position, end);
        position = end + 1;
        if (line.length * 3 > maxLineBytes && (line.length > maxLineBytes || Buffer.byteLength(line, "utf8") > maxLineBytes)) {
          throw this.tooLong(lineNumber + 1);
        }
        lineNumber += 1;
        if (line.trim() === "") continue;
        try {
          receipts.push(JSON.parse(line) as CapsuleReceipt);
        } catch (error) {
          throw new Error(`Invalid JSONL receipt at ${this.path}:${lineNumber}.`, { cause: error });
        }
      }
    } finally {
      this.position = position;
      this.lineNumber = lineNumber;
    }
  }

  /** The last line when the file does not end with a line break. Call once fill returned false. */
  finish(): string | undefined {
    const line = this.pending + this.decoder.end();
    this.pending = "";
    if (line === "") return undefined;
    this.assertWithinLimit(line);
    return line;
  }

  /** Parses one line and counts it. Undefined for a blank line. */
  parse(line: string): CapsuleReceipt | undefined {
    this.lineNumber += 1;
    if (line.trim() === "") return undefined;
    try {
      return JSON.parse(line) as CapsuleReceipt;
    } catch (error) {
      throw new Error(`Invalid JSONL receipt at ${this.path}:${this.lineNumber}.`, { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.file.close();
  }

  // A line of n UTF-16 units has between n and 3n UTF-8 bytes; only a line within that range of the
  // limit needs the exact count.
  private assertWithinLimit(line: string): void {
    if (line.length > this.maxLineBytes || (line.length * 3 > this.maxLineBytes && Buffer.byteLength(line, "utf8") > this.maxLineBytes)) {
      throw this.tooLong();
    }
  }

  private tooLong(lineNumber = this.lineNumber + 1): Error {
    return new Error(`JSONL receipt at ${this.path}:${lineNumber} is longer than maxLineBytes (${this.maxLineBytes} bytes).`);
  }
}

function assertMaxLineBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("JSONL receipt store maxLineBytes must be a positive integer.");
  }
}

export function jsonlReceiptStore(path: string, options: Omit<JsonlReceiptStoreOptions, "path"> = {}): JsonlReceiptStore {
  return new JsonlReceiptStore({ path, ...options });
}
