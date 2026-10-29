// PERF-05: the newest-N window behind Kubernetes log collection. Pure unit test, no client.
import { describe, expect, it } from "vitest";
import { NewestWindow } from "./kubernetes-adapter.js";

interface Item {
  value: number;
  source: number;
  line: number;
}

// A total order like compareOrderedLogs: value, then the unique (source, line) pair.
const order = (left: Item, right: Item) => left.value - right.value || left.source - right.source || left.line - right.line;

function sources(count: number, perSource: number, seed: number): Item[][] {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, (_, source) => Array.from({ length: perSource }, (_, line) => ({ value: Math.floor(random() * 500), source, line })));
}

describe("NewestWindow", () => {
  it("keeps exactly the cap newest entries, oldest first, for any cap", () => {
    const batches = sources(120, 25, 7);
    const all = batches.flat().sort(order);
    for (const cap of [0, 1, 20, 100, 1499, 3000, 10_000]) {
      const window = new NewestWindow<Item>(cap, order);
      for (const batch of batches) window.add(batch);
      expect(window.result()).toEqual(cap === 0 ? [] : all.slice(-cap));
    }
  });

  it("compares about once per entry and window size, not once per source and kept entry", () => {
    // Merging every source into the kept window and sorting it again, as M1 first did, took about
    // 1.9 million comparisons for 120 sources of 25 entries with a 10000 cap.
    let comparisons = 0;
    const counting = (left: Item, right: Item) => {
      comparisons += 1;
      return order(left, right);
    };
    const window = new NewestWindow<Item>(10_000, counting);
    for (const batch of sources(120, 25, 11)) window.add(batch);
    expect(window.result()).toHaveLength(3000);
    expect(comparisons).toBeLessThan(3000 * Math.ceil(Math.log2(3000)) * 2);
  });
});
