// Counted import cost of one ESM entry: heap growth after a GC and the Node internal modules it loads.
import { pathToFileURL } from "node:url";
const entry = process.argv[2];
globalThis.gc();
const before = new Set(process.moduleLoadList);
const heap0 = process.memoryUsage().heapUsed;
await import(pathToFileURL(entry).href);
globalThis.gc();
const heap1 = process.memoryUsage().heapUsed;
const added = process.moduleLoadList.filter((name) => !before.has(name));
console.log(JSON.stringify({ heapDeltaKiB: Math.round((heap1 - heap0) / 1024), internalModulesAdded: added.length, added }));
