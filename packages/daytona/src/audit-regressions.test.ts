// Audit regressions for the M1 campaign (Daytona sandbox). Each test asserts the INTENDED behavior from
// the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The
// owner who fixes an ID flips its it.fails to it in the same commit. The client is an injected fake that
// returns the exact FileInfo shape of the installed @daytona/toolbox-api-client (name, no path field).
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { daytona } from "./index.js";

function fakeWorkspace() {
  const fileInfo = { group: "root", isDir: false, modTime: "", mode: "", name: "out.txt", owner: "root", permissions: "", size: 1 };
  const workspace = {
    id: "audit-daytona",
    process: { executeCommand: async () => ({ exitCode: 0, result: "" }) },
    fs: {
      uploadFile: async () => {},
      downloadFile: async () => Buffer.from("artifact body"),
      listFiles: async () => [fileInfo]
    },
    delete: async () => {}
  };
  return daytona({ client: { create: async () => workspace } as never });
}

describe("M1 audit regressions: daytona", () => {
  it.fails("SB-09: listFiles entries carry the requested directory so they round-trip through readFile", async () => {
    const box = await new Capsule({ adapter: fakeWorkspace() }).sandbox.create({});
    const absolute = await box.listFiles("/workspace/build");
    expect(absolute[0]?.path).toBe("/workspace/build/out.txt");
    const relative = await box.listFiles("build");
    expect(relative[0]?.path).toBe("build/out.txt");
  });

  it.fails("SB-10b: sandbox.artifacts is not claimed unless artifactPaths are actually collected", async () => {
    const capsule = new Capsule({ adapter: fakeWorkspace() });
    if (!capsule.supports("sandbox.artifacts")) return;
    const box = await capsule.sandbox.create({});
    const result = await box.exec({ command: "true", artifactPaths: ["/workspace/out.txt"] });
    expect(result.artifacts).toHaveLength(1);
  });
});
