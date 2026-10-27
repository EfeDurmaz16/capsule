// Offline consistency checks between handwritten docs and the source they describe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function markdownSections(markdown) {
  const sections = new Map();
  let heading;
  for (const line of markdown.split("\n")) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      heading = match[1].trim();
      sections.set(heading, "");
    } else if (heading) {
      sections.set(heading, `${sections.get(heading)}${line}\n`);
    }
  }
  return sections;
}

test("DOC-03: every quickstart capabilities command selects the adapter of its own section", () => {
  const adapterBySection = {
    Docker: "docker",
    E2B: "e2b",
    Daytona: "daytona",
    Modal: "modal",
    Neon: "neon",
    "Cloudflare Workers": "cloudflare",
    "Cloud Run": "cloud-run",
    Vercel: "vercel",
    Kubernetes: "kubernetes",
    Lambda: "lambda",
    "ECS/Fargate": "ecs",
    EC2: "ec2",
    "Fly Machines": "fly",
    "Azure Container Apps": "azure-container-apps"
  };
  const sections = markdownSections(read("docs/real-provider-quickstarts.md"));
  let commands = 0;
  for (const [heading, body] of sections) {
    for (const match of body.matchAll(/capabilities --adapter ([a-z0-9-]+)/g)) {
      commands += 1;
      assert.ok(heading in adapterBySection, `unexpected quickstart section ${heading}`);
      assert.equal(match[1], adapterBySection[heading], `the ${heading} quickstart inspects --adapter ${match[1]}`);
    }
  }
  assert.ok(commands > 0);
});

test("DOC-03: quickstarts use the Azure environment variable the adapter and live gate read", () => {
  const adapter = read("packages/azure/src/azure-container-apps-adapter.ts");
  const canonical = /process\.env\.(AZURE_CONTAINERAPPS_ENVIRONMENT_ID)/.exec(adapter)?.[1];
  assert.equal(canonical, "AZURE_CONTAINERAPPS_ENVIRONMENT_ID");
  const azure = markdownSections(read("docs/real-provider-quickstarts.md")).get("Azure Container Apps");
  assert.match(azure, /export AZURE_CONTAINERAPPS_ENVIRONMENT_ID=/);
  assert.match(azure, /environmentId: process\.env\.AZURE_CONTAINERAPPS_ENVIRONMENT_ID/);
  assert.doesNotMatch(azure, /export AZURE_CONTAINER_APP_ENVIRONMENT_ID=/);
});

test("DOC-04: roadmap current-adapter lines claim no domain the generated matrix marks unsupported", () => {
  const matrix = read("docs/provider-matrix.md");
  const header = matrix.split("\n").find((line) => line.startsWith("| Provider | Package |"));
  const columns = header.split("|").map((cell) => cell.trim());
  const rows = matrix
    .split("\n")
    .filter((line) => /^\| [A-Z].* \| `@capsule-sdk\//.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()));
  const domainWords = { Sandbox: /\bsandbox/i, Job: /\bjobs?\b/i, Service: /\bservices?\b/i, Machine: /\bmachines?\b(?! lifecycle)|machine lifecycle/i };
  const roadmap = read("docs/roadmap.md");
  const current = roadmap.slice(roadmap.indexOf("Current real adapters"), roadmap.indexOf("Next real adapters"));
  const bullets = current.split("\n").filter((line) => line.startsWith("- "));
  let checked = 0;
  for (const row of rows) {
    const provider = row[1];
    const shortName = provider.split(" ")[0];
    const bullet = bullets.find((line) => line.includes(provider) || line.includes(`${shortName} `));
    if (!bullet) continue;
    // Only the first sentence states current support; later sentences may name future targets.
    const claimed = bullet.split(/\.(\s|$)/)[0];
    for (const [domain, pattern] of Object.entries(domainWords)) {
      const level = row[columns.indexOf(domain)];
      if (level !== "unsupported") continue;
      const providerClause = claimed.slice(claimed.indexOf(shortName)).split(/,|\band\b (?=[A-Z])/)[0];
      assert.doesNotMatch(providerClause, pattern, `roadmap claims ${domain.toLowerCase()} support for ${provider}: ${bullet}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0);
});

test("DOC-05: release docs name the @capsule-sdk scope and every public package", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const publicPackages = readdirSync(join(root, "packages"))
    .map((dir) => join("packages", dir, "package.json"))
    .filter((path) => existsSync(join(root, path)))
    .map((path) => JSON.parse(read(path)))
    .filter((pkg) => pkg.private !== true)
    .map((pkg) => pkg.name)
    .sort();
  assert.ok(publicPackages.every((name) => name.startsWith("@capsule-sdk/")));

  for (const path of ["docs/release-rollback.md", ".changeset/README.md"]) {
    assert.doesNotMatch(read(path), /`@capsule`|@capsule scope|@capsule\b(?!-sdk)/, `${path} names the wrong npm scope`);
  }
  const listed = /package name \(([^)]+)\) is available/
    .exec(read("docs/release-rollback.md"))?.[1]
    .split(",")
    .map((name) => `@capsule-sdk/${name.trim()}`);
  assert.deepEqual(listed?.sort(), publicPackages);
});

test("DOC-05: release docs separate a green release run from publication", () => {
  assert.match(read("docs/release-rollback.md"), /green `Release` run therefore is not evidence that anything was published/);
  assert.match(read(".changeset/README.md"), /A green workflow run is not publication proof/);
});

test("DOC-06: receipt claims match the off-by-default capture in core and the raw() bypass", () => {
  const capsuleSource = read("packages/core/src/capsule.ts");
  assert.match(capsuleSource, /this\.options\.receipts \?\? false/, "core still defaults receipt capture to off");
  const readme = read("README.md");
  assert.doesNotMatch(readme, /Every call through it is capability-checked, policy-checked, and recorded as a receipt/);
  assert.doesNotMatch(readme, /Every action produces a normalized record/);
  assert.match(readme, /`receipts: true`; it is off by default/);
  assert.match(readme, /`raw\(\)` returns the native provider client[^\n]*Calls through it skip Capsule's checks and receipts by design/);
  const receiptsDoc = read("docs/execution-receipts.md");
  assert.match(receiptsDoc, /Receipt capture is off by default/);
  assert.match(receiptsDoc, /Read-only coverage is uneven/);
  assert.match(receiptsDoc, /`raw\(\)` returns the native provider client and bypasses/);
});

test("DOC-07: golden live receipt samples use declared capability paths and stay labeled placeholders", async () => {
  const { loadAdapters } = await import("./capsule-gap-report.mjs");
  const adapters = new Map(loadAdapters(root).map((adapter) => [adapter.packageDir, adapter.capabilities]));
  const packageDirByProvider = { "azure-container-apps": "azure" };
  const fixture = JSON.parse(read("docs/live-receipt-samples/golden-live-receipts.json"));
  assert.match(fixture.description, /placeholder/i);
  assert.match(fixture.description, /not captured provider outputs/);
  assert.ok(fixture.samples.length > 0);

  for (const sample of fixture.samples) {
    assert.match(sample.id, /^receipt-sample-/, `${sample.id} must stay an unmistakable sample id`);
    assert.equal(sample.metadata?.sampleSanitized, true, `${sample.id} must be marked sampleSanitized`);
    const capabilities = adapters.get(packageDirByProvider[sample.provider] ?? sample.provider);
    assert.ok(capabilities, `${sample.id}: unknown provider ${sample.provider}`);
    const [domain, operation, ...rest] = sample.capabilityPath.split(".");
    assert.equal(rest.length, 0, `${sample.id}: ${sample.capabilityPath} is not a domain.operation capability path`);
    const declared = capabilities[domain]?.[operation];
    assert.ok(declared && declared !== "unsupported", `${sample.id}: ${sample.capabilityPath} is not a supported ${sample.provider} capability`);
    assert.equal(sample.supportLevel, declared, `${sample.id}: support level differs from the adapter declaration`);
  }
});

test("DOC-08: the documented typecheck command is the one package.json runs", () => {
  const typecheck = JSON.parse(read("package.json")).scripts.typecheck;
  assert.equal(typecheck, "tsc -p tsconfig.typecheck.json --noEmit");
  const decisions = read("docs/technical-decisions.md");
  assert.ok(decisions.includes(`\`${typecheck}\``), "technical-decisions.md must name the actual typecheck command");
  assert.doesNotMatch(decisions, /`tsc -b`/);
});

test("DOC-09: a deferred item is either skipped visibly and documented, or closed with a regression test", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const roadmap = read("docs/roadmap.md");
  const deferred = [];
  const tests = [];
  for (const dir of readdirSync(join(root, "packages"))) {
    const src = join(root, "packages", dir, "src");
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src).filter((name) => name.endsWith(".test.ts"))) {
      const path = `packages/${dir}/src/${file}`;
      const text = read(path);
      tests.push({ path, text });
      for (const match of text.matchAll(/(?:it|test)\.skip\("([A-Z]+-\d+) \(deferred\)/g)) deferred.push({ id: match[1], path });
    }
  }
  for (const { id, path } of deferred) {
    const row = roadmap.split("\n").find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));
    assert.ok(row, `${id} is skipped in ${path} but not listed in docs/roadmap.md`);
    assert.ok(row.includes(path), `${id} row must name ${path}`);
  }
  // Items the roadmap reports closed must each have a regression test named after them and no skip.
  const closed = /deferred items of the M1 correctness audit \(([^)]+)\) are closed/.exec(roadmap);
  assert.ok(closed, "docs/roadmap.md must list the closed deferred items");
  const ids = closed[1].split(",").map((id) => id.trim());
  assert.deepEqual(ids, ["GAP-14", "GAP-20", "PERF-11", "PERF-12", "PERF-14"]);
  for (const id of ids) {
    assert.ok(!deferred.some((entry) => entry.id === id), `${id} is reported closed but still skipped`);
    const named = tests.filter(({ text }) => new RegExp(`(?:describe|it|test)(?:\\.each\\([^)]*\\))?\\(\\s*"${id}[:\\s]`).test(text));
    assert.ok(named.length > 0, `${id} is reported closed but no test is named after it`);
  }
});

test("DOC-09: the receipt type union and the committed JSON Schema enum agree", () => {
  const types = read("packages/core/src/types.ts");
  const union = /export interface CapsuleReceipt \{[\s\S]*?\n  type:\n([\s\S]*?);\n/.exec(types)?.[1];
  const fromTypes = [...union.matchAll(/\| "([a-z.]+)"/g)].map((match) => match[1]).sort();
  const fromSchema = [...JSON.parse(read("schemas/capsule-receipt.schema.json")).properties.type.enum].sort();
  assert.deepEqual(fromTypes, fromSchema);
});
