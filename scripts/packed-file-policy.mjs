// Which files a packed public Capsule package may contain. A tarball holds package.json, optional
// license/readme/changelog files and built dist output only: no sources, tests, fixtures, env files
// or build caches.
const rootMetadata = /^(package\.json|LICENSE(\.md|\.txt)?|README(\.md)?|CHANGELOG\.md)$/i;
const distFile = /^dist\/.+\.(js|d\.ts|js\.map|d\.ts\.map)$/;
const testOrFixture = /(^|\/)(__tests__|__fixtures__|__mocks__|fixtures)\/|\.(test|spec)\.|\.live\./;
const neverShipped = /(^|\/)(\.env(\..*)?|\.npmrc|[^/]*\.tsbuildinfo)$/;

/** Returns human-readable violations for one tarball's entry list (paths as printed by `tar -t`). */
export function packedEntryViolations(packageName, entries, { main = "./dist/index.js" } = {}) {
  const violations = [];
  const files = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0 && !entry.endsWith("/"));
  const relativeFiles = [];
  for (const entry of files) {
    if (!entry.startsWith("package/")) {
      violations.push(`${packageName}: unexpected tarball root for ${entry}`);
      continue;
    }
    relativeFiles.push(entry.slice("package/".length));
  }
  for (const file of relativeFiles) {
    if (neverShipped.test(file)) violations.push(`${packageName}: ships ${file}, which must never be published`);
    else if (testOrFixture.test(file)) violations.push(`${packageName}: ships test or fixture file ${file}`);
    else if (!rootMetadata.test(file) && !distFile.test(file)) violations.push(`${packageName}: ships unexpected file ${file}`);
  }
  if (!relativeFiles.includes("package.json")) violations.push(`${packageName}: tarball has no package.json`);
  const mainFile = main.replace(/^\.\//, "");
  if (!relativeFiles.includes(mainFile)) violations.push(`${packageName}: tarball is missing its entrypoint ${mainFile}`);
  return violations;
}
