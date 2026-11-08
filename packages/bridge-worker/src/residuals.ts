import { classifyResiduals, liveSet, type OwnerSets, type ResidualScan } from "@capsule-sdk/core";
import type { BridgeDriver } from "./driver.js";

// The residual scan for the bridge worker's internal API. Fabric knows which of its operations and jobs
// are live and which ended; the worker only lists what carries its labels in the bound scope. The labels
// name no daemon, and two daemons can share one engine, so an owner the caller names in neither set is
// unknown and kept: only what the caller itself ended is ever a residual. Removal stays the v1
// sandbox.destroy action, which needs a fresh approval and is observed gone. Listing is not a v1 frame:
// the protocol fixtures are pinned on the Fabric side, so a wire addition waits for both sides.

/**
 * Lists the resources this worker's labels mark whose operation or job the caller ended and holds no
 * longer live. Anything else is kept. A read: no provider state changes. Throws when the profile cannot
 * list labelled resources.
 */
export async function listResiduals(driver: BridgeDriver, owners: { live?: OwnerSets; ended?: OwnerSets }): Promise<ResidualScan> {
  if (!driver.labeled) throw new Error(`the ${driver.profile.profile} profile cannot list labelled resources`);
  return classifyResiduals(driver.profile.provider, driver.profile.profile, await driver.labeled(), liveSet(owners));
}
