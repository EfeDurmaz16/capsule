import { Capsule } from "@capsule/core";
import { mockCloudRun, mockCloudflare, mockDaytona, mockE2B, mockEC2, mockECS, mockKubernetes, mockLambda, mockModal, mockNeon, mockVercel } from "@capsule/adapter-mock";

const adapters = [mockE2B(), mockModal(), mockDaytona(), mockCloudRun(), mockVercel(), mockCloudflare(), mockNeon(), mockLambda(), mockECS(), mockKubernetes(), mockEC2()];
for (const adapter of adapters) {
  const capsule = new Capsule({ adapter });
  console.log(adapter.name, {
    sandboxExec: capsule.supports("sandbox.exec"),
    serviceDeploy: capsule.supports("service.deploy"),
    databaseBranchCreate: capsule.supports("database.branchCreate"),
    machineCreate: capsule.supports("machine.create")
  });
}
