import { spawn } from "node:child_process";

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunDockerOptions {
  timeoutMs?: number;
  input?: string;
}

export function runDocker(args: string[], options: RunDockerOptions = {}): Promise<DockerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            child.kill("SIGKILL");
            resolve({
              exitCode: 124,
              stdout,
              stderr: stderr ? `${stderr}\nCommand timed out after ${options.timeoutMs}ms` : `Command timed out after ${options.timeoutMs}ms`
            });
          }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      }
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const result = await runDocker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
