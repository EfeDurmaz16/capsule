import type { LogEntry } from "./types.js";

export function logsFromOutput(stdout: string, stderr: string): LogEntry[] {
  const now = new Date().toISOString();
  return [
    ...stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => ({ timestamp: now, stream: "stdout" as const, message })),
    ...stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => ({ timestamp: now, stream: "stderr" as const, message }))
  ];
}
