import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Capsule } from "../../packages/core/dist/index.js";
import { gce } from "../../packages/gce/dist/index.js";

const [action, projectId, zone, name, publicKeyPath] = process.argv.slice(2);
if (!["create", "status", "destroy"].includes(action) || !projectId || !zone || !name || (action === "create" && !publicKeyPath)) {
  console.error("Usage: node runner.mjs create|status|destroy PROJECT ZONE NAME [PUBLIC_KEY_PATH]");
  process.exit(2);
}
const accessToken = () => execFileSync("gcloud", ["auth", "print-access-token", "--quiet"], { encoding: "utf8" }).trim();
const adapter = gce({
  projectId,
  zone,
  accessToken,
  maxRunSeconds: 7200,
  startupScript: readFileSync(new URL("./bootstrap.sh", import.meta.url), "utf8"),
  sshKeys: publicKeyPath ? "fabrictest:" + readFileSync(publicKeyPath, "utf8").trim() : undefined
});
const capsule = new Capsule({ adapter, receipts: true });
const result =
  action === "create"
    ? await capsule.machine.create({ name, size: "e2-small", idempotencyKey: name, labels: { purpose: "fabric-handoff-test" } })
    : action === "status"
      ? await capsule.machine.status({ id: name })
      : await capsule.machine.destroy({ id: name, idempotencyKey: name });
console.log(JSON.stringify(result));
