import type { ActionCapability, BridgeAction, CapabilityProfile } from "./wire.js";

// The v1 capability profiles, field for field and in the same key order as
// protocol/bridge/v1/profiles/*.json. The worker sends the chosen one whole in hello_ack and enforces
// it. A test compares both documents with the fixtures byte for byte after serialization.

const limits = {
  max_deadline_ms: 600_000,
  max_observe_wait_ms: 30_000,
  max_output_bytes: 1_048_576,
  max_stdin_bytes: 65_536,
  max_argv: 64,
  max_receipts: 16
};

export const fixtureProfile: CapabilityProfile = Object.freeze({
  profile: "fixture",
  version: 1,
  provider: "fixture",
  scope_keys: ["account", "project"],
  resource_kinds: ["sandbox"],
  clock: "virtual",
  observe_interval_ms: 1000,
  actions: [
    {
      action: "sandbox.create",
      effect: "create",
      terminal_only: true,
      observe: true,
      cancel: false,
      approval: "optional",
      dedupe: "provider_key",
      secrets: true
    },
    {
      action: "sandbox.exec",
      effect: "mutate",
      terminal_only: false,
      observe: false,
      cancel: true,
      approval: "optional",
      dedupe: "none",
      secrets: true
    },
    {
      action: "sandbox.destroy",
      effect: "destroy",
      terminal_only: true,
      observe: true,
      cancel: false,
      approval: "required",
      dedupe: "provider_key",
      secrets: false
    }
  ],
  limits
}) as CapabilityProfile;

export const dockerProfile: CapabilityProfile = Object.freeze({
  profile: "docker",
  version: 1,
  provider: "docker",
  scope_keys: ["engine"],
  resource_kinds: ["container"],
  clock: "wall",
  observe_interval_ms: 250,
  image_pull: "never",
  actions: [
    {
      action: "sandbox.create",
      effect: "create",
      terminal_only: true,
      observe: true,
      cancel: false,
      approval: "optional",
      dedupe: "label_query",
      secrets: true
    },
    {
      action: "sandbox.exec",
      effect: "mutate",
      terminal_only: false,
      observe: false,
      cancel: false,
      approval: "optional",
      dedupe: "none",
      secrets: true
    },
    {
      action: "sandbox.destroy",
      effect: "destroy",
      terminal_only: true,
      observe: true,
      cancel: false,
      approval: "required",
      dedupe: "label_query",
      secrets: false
    }
  ],
  limits
}) as CapabilityProfile;

export const profiles: Readonly<Record<string, CapabilityProfile>> = Object.freeze({ fixture: fixtureProfile, docker: dockerProfile });

export function actionCapability(profile: CapabilityProfile, action: string): ActionCapability | undefined {
  return profile.actions.find((entry) => entry.action === (action as BridgeAction));
}
