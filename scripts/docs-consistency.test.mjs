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
