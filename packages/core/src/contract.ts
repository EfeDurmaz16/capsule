import type { CapsuleAdapter } from "./adapters.js";

export function assertAdapterContract(adapter: CapsuleAdapter): void {
  if (!adapter.name) {
    throw new Error("Adapter must declare a name");
  }
  if (!adapter.provider) {
    throw new Error("Adapter must declare a provider");
  }
  if (!adapter.capabilities) {
    throw new Error("Adapter must declare capabilities");
  }
}
