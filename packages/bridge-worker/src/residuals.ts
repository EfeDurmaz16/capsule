import { classifyResiduals, liveSet, type ResidualScan } from "@capsule-sdk/core";
import type { BridgeDriver } from "./driver.js";

// The residual scan for the bridge worker's internal API. Fabric knows which operations and jobs are
// live; the worker only lists what carries its labels in the bound scope. Removal stays the v1
// sandbox.destroy action, which needs a fresh approval and is observed gone. Listing is not a v1 frame:
// the protocol fixtures are pinned on the Fabric side, so a wire addition waits for both sides.

/**
 * Lists the resources this worker's labels mark that belong to no live operation or job. A read: no
 * provider state changes. Throws when the profile cannot list labelled resources.
 */
export async function listResiduals(driver: BridgeDriver, live: { operations?: Iterable<string>; jobs?: Iterable<string> }): Promise<ResidualScan> {
  if (!driver.labeled) throw new Error(`the ${driver.profile.profile} profile cannot list labelled resources`);
  return classifyResiduals(driver.profile.provider, driver.profile.profile, await driver.labeled(), liveSet(live));
}
