import assert from "node:assert/strict";
import { modal } from "@capsule-sdk/modal";
import { runProviderHttpFixture } from "./emulate-http-fixture.js";

// modal 0.7.4 uses unary protobuf RPCs over HTTP/2. All fixture response fields
// fit in one-byte protobuf tags and lengths (modal_proto/api.proto).
function bytesField(number: number, value: string | Buffer): Buffer {
  const bytes = Buffer.from(value);
  assert.ok(number < 16 && bytes.length < 128);
  return Buffer.concat([Buffer.from([(number << 3) | 2, bytes.length]), bytes]);
}

function grpcReply(...fields: Buffer[]) {
  const payload = Buffer.concat(fields);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return { status: 200, headers: { "content-type": "application/grpc" }, body: Buffer.concat([header, payload]) };
}

export async function runModalHttp() {
  // The SDK ignores its typed endpoint option and reads MODAL_SERVER_URL. Only
  // change it inside the dedicated scenario child, where no other client runs.
  assert.equal(process.env.CAPSULE_EMULATE_PROVIDER, "modal", "Run the Modal fixture in the isolated provider process.");
  const appName = "capsule-emulate";
  const environment = "emulator";
  const image = "debian:bookworm-slim";
  const appId = "ap-capsule";
  const imageId = "im-capsule";
  // Modal V1 sandbox IDs carry a 22-character base62 suffix.
  const sandboxId = "sb-0000000000000000000001";
  const tokenId = "capsule-local-id";
  const tokenSecret = "capsule-local-secret";
  const token = "fixture." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".fixture";
  let state: "empty" | "running" | "terminated" = "empty";
  let polls = 0;

  return runProviderHttpFixture({
    provider: "modal",
    protocol: "grpc",
    adapter(origin) {
      process.env.MODAL_SERVER_URL = origin;
      return modal({ appName, environment, tokenId, tokenSecret, terminateDeadlineMs: 5_000 });
    },
    handle({ url, method, headers, body }) {
      assert.equal(method, "POST");
      assert.match(String(headers["content-type"]), /^application\/grpc/);
      assert.equal(headers["x-modal-token-id"], tokenId);
      assert.equal(headers["x-modal-token-secret"], tokenSecret);
      assert.equal(body[0], 0, "Expected an uncompressed unary request");
      assert.equal(body.readUInt32BE(1), body.length - 5);
      const payload = body.subarray(5);
      const prefix = "/modal.client.ModalClient/";
      assert.ok(url.pathname.startsWith(prefix));
      const rpc = url.pathname.slice(prefix.length);
      if (rpc === "AuthTokenGet") {
        assert.equal(payload.length, 0);
        return grpcReply(bytesField(1, token));
      }
      assert.equal(headers["x-modal-auth-token"], token);
      switch (rpc) {
        case "AppGetOrCreate":
          assert.deepEqual(payload, Buffer.concat([bytesField(1, appName), bytesField(2, environment), Buffer.from([24, 1])]));
          return grpcReply(bytesField(1, appId));
        case "ImageGetOrCreate":
          assert.ok(payload.includes(bytesField(4, appId)));
          assert.ok(payload.includes(Buffer.from(`FROM ${image}`)));
          // ImageGetOrCreateResponse.result.status = GENERIC_STATUS_SUCCESS.
          return grpcReply(bytesField(1, imageId), bytesField(2, Buffer.from([8, 1])));
        case "SandboxCreate":
          assert.equal(state, "empty");
          assert.ok(payload.includes(bytesField(1, appId)));
          assert.ok(payload.includes(bytesField(3, imageId)));
          state = "running";
          return grpcReply(bytesField(1, sandboxId));
        case "SandboxTerminate":
          assert.equal(state, "running");
          assert.deepEqual(payload, bytesField(1, sandboxId));
          state = "terminated";
          return grpcReply();
        case "SandboxWait":
          assert.equal(state, "terminated");
          assert.deepEqual(payload, bytesField(1, sandboxId));
          polls++;
          // SandboxWaitResponse.result.status = GENERIC_STATUS_TERMINATED.
          return grpcReply(bytesField(1, Buffer.from([8, 3])));
      }
    },
    async exercise(capsule) {
      const sandbox = await capsule.sandbox.create({ image, timeoutMs: 60_000 });
      assert.equal(sandbox.handle.id, sandboxId);
      await sandbox.destroy();
      assert.equal(state, "terminated");
      assert.ok(polls > 0);
      return {
        result: { resourceId: sandboxId, status: "deleted" },
        cleanup: "emulator-destroyed",
        assertions: ["The Modal SDK created a sandbox with the resolved app and image IDs.", "The SDK observed termination over gRPC."]
      };
    }
  });
}
