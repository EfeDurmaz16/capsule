import type { CapabilityMap, SupportLevel } from "@capsule/core";

const unsupported: SupportLevel = "unsupported";

export function capabilities(levels: {
  sandbox?: SupportLevel;
  job?: SupportLevel;
  service?: SupportLevel;
  edge?: SupportLevel;
  database?: SupportLevel;
  preview?: SupportLevel;
  machine?: SupportLevel;
  databaseBranchCreate?: SupportLevel;
  databaseConnectionString?: SupportLevel;
}): CapabilityMap {
  return {
    sandbox: {
      create: levels.sandbox ?? unsupported,
      exec: levels.sandbox ?? unsupported,
      fileRead: levels.sandbox ?? unsupported,
      fileWrite: levels.sandbox ?? unsupported,
      fileList: levels.sandbox ?? unsupported,
      destroy: levels.sandbox ?? unsupported,
      upload: levels.sandbox ?? unsupported,
      download: levels.sandbox ?? unsupported,
      snapshot: levels.sandbox === "native" ? "experimental" : (levels.sandbox ?? unsupported),
      restore: levels.sandbox === "native" ? "experimental" : (levels.sandbox ?? unsupported),
      exposePort: levels.sandbox ?? unsupported,
      mountWorkspace: levels.sandbox ?? unsupported,
      networkPolicy: levels.sandbox ? "experimental" : unsupported,
      filesystemPolicy: levels.sandbox ? "emulated" : unsupported,
      secretMounting: levels.sandbox ? "emulated" : unsupported,
      streamingLogs: levels.sandbox ?? unsupported,
      artifacts: levels.sandbox ? "emulated" : unsupported
    },
    job: {
      run: levels.job ?? unsupported,
      status: unsupported,
      cancel: unsupported,
      logs: levels.job ?? unsupported,
      artifacts: levels.job ? "emulated" : unsupported,
      timeout: levels.job ?? unsupported,
      env: levels.job ?? unsupported,
      resources: levels.job ?? unsupported
    },
    service: {
      deploy: levels.service ?? unsupported,
      update: levels.service ?? unsupported,
      delete: levels.service ?? unsupported,
      status: levels.service ?? unsupported,
      logs: levels.service ?? unsupported,
      url: levels.service ?? unsupported,
      scale: levels.service ?? unsupported,
      rollback: levels.service ?? unsupported,
      domains: levels.service ?? unsupported,
      healthcheck: levels.service ?? unsupported,
      secrets: levels.service ?? unsupported
    },
    edge: {
      deploy: levels.edge ?? unsupported,
      version: levels.edge ?? unsupported,
      release: levels.edge ?? unsupported,
      rollback: levels.edge ?? unsupported,
      routes: levels.edge ?? unsupported,
      bindings: levels.edge ?? unsupported,
      logs: levels.edge ?? unsupported,
      url: levels.edge ?? unsupported
    },
    database: {
      branchCreate: levels.databaseBranchCreate ?? levels.database ?? unsupported,
      branchDelete: levels.database ?? unsupported,
      branchReset: levels.database ?? unsupported,
      connectionString: levels.databaseConnectionString ?? levels.database ?? unsupported,
      migrate: levels.database ?? unsupported,
      snapshot: levels.database ?? unsupported,
      restore: levels.database ?? unsupported
    },
    preview: {
      create: levels.preview ?? unsupported,
      destroy: levels.preview ?? unsupported,
      status: levels.preview ?? unsupported,
      logs: levels.preview ?? unsupported,
      urls: levels.preview ?? unsupported,
      ttl: levels.preview ?? unsupported,
      cleanup: levels.preview ?? unsupported
    },
    machine: {
      create: levels.machine ?? unsupported,
      exec: levels.machine ?? unsupported,
      start: levels.machine ?? unsupported,
      stop: levels.machine ?? unsupported,
      destroy: levels.machine ?? unsupported,
      snapshot: levels.machine ?? unsupported,
      volume: levels.machine ?? unsupported,
      network: levels.machine ?? unsupported
    }
  };
}
