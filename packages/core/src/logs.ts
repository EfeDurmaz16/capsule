import type { LogEntry } from "./types.js";

export function logsFromOutput(stdout: string, stderr: string, source?: string): LogEntry[] {
  const now = new Date().toISOString();
  const line = (stream: "stdout" | "stderr", message: string): LogEntry =>
    source ? { timestamp: now, stream, message, source } : { timestamp: now, stream, message };
  return [
    ...stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => line("stdout", message)),
    ...stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => line("stderr", message))
  ];
}
