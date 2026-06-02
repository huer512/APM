#!/usr/bin/env node
import { bootstrapSeaRuntime } from "../utils/sea-bootstrap.js";
import { setMaxListeners } from "node:events";
import { ApmDaemonServer } from "../daemon/server.js";
import { resolveApmHomeDir, resolveApmSocketPath } from "../utils/apm-home.js";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write("Usage: apm-daemon [--socket <socketPath>]\n");
    return;
  }

  bootstrapSeaRuntime();
  // The Cursor SDK stack may attach multiple abort listeners internally.
  // Raise the process-wide cap to avoid noisy false-positive warnings.
  setMaxListeners(50);

  const apmHomeDir = resolveApmHomeDir();
  const socketPath = parseSocketArg() ?? resolveApmSocketPath(apmHomeDir);
  const daemon = new ApmDaemonServer({ workspaceRoot: apmHomeDir, socketPath });
  await daemon.start();
  const httpInfo = daemon.getHttpInfo();
  process.stdout.write(`apm daemon listening on ${socketPath}\n`);
  if (httpInfo.baseUrl) {
    process.stdout.write(`apm http api ${httpInfo.baseUrl}\n`);
  }

  const cleanup = async (): Promise<void> => {
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void cleanup());
  process.on("SIGTERM", () => void cleanup());
}

void main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

function parseSocketArg(): string | undefined {
  const index = process.argv.indexOf("--socket");
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (value && !value.startsWith("-")) {
      return value;
    }
  }
  return undefined;
}
