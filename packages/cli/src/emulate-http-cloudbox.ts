export async function runCloudboxProviderHttp(provider: "docker" | "e2b" | "daytona" | "modal") {
  switch (provider) {
    case "daytona":
      return (await import("./emulate-http-daytona.js")).runDaytonaHttp();
    case "docker":
      return (await import("./emulate-http-docker.js")).runDockerHttp();
    case "e2b":
      return (await import("./emulate-http-e2b.js")).runE2BHttp();
    case "modal":
      return (await import("./emulate-http-modal.js")).runModalHttp();
  }
}
