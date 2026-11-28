import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { createServer as createHttp2Server, type Http2ServerRequest, type Http2ServerResponse, type ServerHttp2Session } from "node:http2";
import { Capsule, MemoryReceiptStore, verifyReceipt, type CapsuleAdapter } from "@capsule-sdk/core";
import type { EmulationProvider } from "./emulate-catalog.js";

export interface ProviderHttpRequest {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface ProviderHttpResponse {
  status: number;
  headers?: OutgoingHttpHeaders;
  body?: string | Buffer;
}

export interface ProviderHttpOutcome {
  result: { resourceId: string; status: string };
  cleanup: "emulator-destroyed" | "no-retained-emulator-state";
  assertions: string[];
}

interface ProviderHttpFixture {
  provider: EmulationProvider;
  protocol?: "grpc";
  handle(request: ProviderHttpRequest): ProviderHttpResponse | undefined | Promise<ProviderHttpResponse | undefined>;
  adapter(origin: string): CapsuleAdapter | Promise<CapsuleAdapter>;
  exercise(capsule: Capsule): Promise<ProviderHttpOutcome>;
}

const host = "127.0.0.1";
const maxRequestBytes = 4 * 1024 * 1024;
const maxRequests = 128;

export function fixtureJson(status: number, value: unknown): ProviderHttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

async function requestBody(request: IncomingMessage | Http2ServerRequest): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += data.length;
    assert.ok(bytes <= maxRequestBytes, "Provider emulator request exceeded the fixture size limit.");
    chunks.push(data);
  }
  return Buffer.concat(chunks, bytes);
}

/** Only a real adapter talking to the fixture over the loopback HTTP socket can produce this evidence. */
export async function runProviderHttpFixture(fixture: ProviderHttpFixture) {
  let origin: string;
  let fixtureError: unknown;
  const requests: { method: string; path: string }[] = [];

  async function reply(request: IncomingMessage | Http2ServerRequest, response: ServerResponse | Http2ServerResponse) {
    try {
      const url = new URL(request.url ?? "/", origin);
      assert.equal(url.origin, origin, "Provider emulator cannot forward a request.");
      assert.ok(requests.length < maxRequests, "Provider emulator exceeded its request limit.");
      const method = request.method ?? "GET";
      requests.push({ method, path: url.pathname });
      const result = await fixture.handle({ method, url, headers: request.headers, body: await requestBody(request) });
      assert.ok(result, `Unexpected ${fixture.provider} emulator request: ${method} ${url.pathname}`);
      assert.ok(result.status < 300 || result.status >= 400, "Provider emulator redirects are forbidden.");
      response.statusCode = result.status;
      for (const [name, value] of Object.entries(result.headers ?? {})) {
        if (value !== undefined) response.setHeader(name, value);
      }
      if (fixture.protocol === "grpc" && result.status === 200) response.addTrailers({ "grpc-status": "0" });
      response.end(result.body ?? "");
    } catch (error) {
      fixtureError ??= error;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.statusCode = 400;
      response.end("Unexpected provider emulator request.");
    }
  }

  const sessions = new Set<ServerHttp2Session>();
  const server = fixture.protocol === "grpc" ? createHttp2Server(reply).setTimeout(15_000) : createServer({ requestTimeout: 15_000 }, reply);
  if (!("closeAllConnections" in server)) {
    server.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
  }
  server.listen({ host, port: 0 });
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://${host}:${address.port}`;

    const adapter = await fixture.adapter(origin);
    const receipts = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: { ...adapter, evidence: "provider-http" },
      receipts: true,
      receiptStore: receipts,
      receiptPersistence: "required"
    });
    const outcome = await fixture.exercise(capsule);
    if (fixtureError) throw fixtureError;
    assert.ok(requests.length > 0, "Expected the real adapter to make a loopback HTTP request.");
    assert.ok(receipts.receipts.length > 0, "Expected the adapter to write Capsule receipts.");
    for (const receipt of receipts.receipts) {
      assert.equal(receipt.provider, adapter.provider);
      assert.equal(receipt.adapter, adapter.name);
      assert.equal(receipt.metadata?.providerEvidence, "provider-http");
      assert.equal(receipt.supportLevel, "emulated");
      assert.ok(verifyReceipt(receipt).valid, `Invalid provider HTTP receipt for ${receipt.capabilityPath}`);
    }
    return {
      provider: fixture.provider,
      evidence: "provider-http" as const,
      ...outcome,
      operations: receipts.receipts.map((receipt) => receipt.capabilityPath),
      requests,
      receipts: receipts.receipts
    };
  } catch (error) {
    throw fixtureError ?? error;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      if ("closeAllConnections" in server) server.closeAllConnections();
      else for (const session of sessions) session.destroy();
    });
  }
}
