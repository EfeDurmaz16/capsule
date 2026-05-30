import type { CapabilityPath } from "@capsule/core";

type CapabilityQueryPath<TPath extends CapabilityPath> = TPath;

type ValidCapabilityQuery = CapabilityQueryPath<"sandbox.exec">;

// @ts-expect-error Unsupported capability paths should fail at compile time for SDK callers.
type InvalidCapabilityQuery = CapabilityQueryPath<"sandbox.flyToMoon">;
