#!/usr/bin/env node
import { setMaxListeners } from "node:events";
import { Command } from "commander";
import { defaultSocketPath } from "../cli/client.js";
import { runCommand } from "../cli/commands/run.js";
import { logsCommand } from "../cli/commands/logs.js";
import { psCommand } from "../cli/commands/ps.js";
import { attachCommand } from "../cli/commands/attach.js";

const program = new Command();
program.name("apm").description("Agent Pipline Manager CLI");

program
  .command("daemon")
  .description("Run daemon in foreground")
  .option("--socket <socketPath>", "Custom socket path")
  .action(async (options: { socket?: string }) => {
    setMaxListeners(50);
    const socketPath = options.socket ?? defaultSocketPath();
    if (process.env.APM_BUNDLED === "1") {
      process.stderr.write("Start the daemon with the apm-daemon binary.\n");
      process.exit(1);
    }
    const { ApmDaemonServer } = await import("../daemon/server.js");
    const { resolveApmHomeDir } = await import("../utils/apm-home.js");
    const daemon = new ApmDaemonServer({
      workspaceRoot: resolveApmHomeDir(),
      socketPath,
    });
    await daemon.start();
    process.stdout.write(`apm daemon listening on ${socketPath}\n`);
  });

program
  .command("run")
  .argument("<entryName>", "Entry name under entries/")
  .option("-d, --detach", "Run in background mode", false)
  .option("-a, --attach", "Attach TUI immediately after run starts", false)
  .option("-p, --param <key=value>", "Pass variable", collect, [])
  .option("--socket <socketPath>", "Custom socket path")
  .action(async (entryName: string, options: { detach: boolean; attach: boolean; param: string[]; socket?: string }) => {
    const socketPath = options.socket ?? defaultSocketPath();
    await runCommand(socketPath, entryName, options.param ?? [], options.detach, options.attach);
  });

program
  .command("logs")
  .argument("<runId>", "Run ID")
  .option("--json", "Output structured JSON events", false)
  .option("--follow", "Follow new events until run completes", false)
  .option("--kind <kind>", "Filter by event kind (run, tool, stage, ...)")
  .option("--from <seq>", "Start from event sequence number", (value) => Number(value))
  .option("--socket <socketPath>", "Custom socket path")
  .action(async (runId: string, options: {
    json: boolean;
    follow: boolean;
    kind?: string;
    from?: number;
    socket?: string;
  }) => {
    const socketPath = options.socket ?? defaultSocketPath();
    await logsCommand(socketPath, runId, {
      json: options.json,
      follow: options.follow,
      kind: options.kind,
      fromSeq: options.from,
    });
  });

program
  .command("ps")
  .option("-a, --all", "Show all runs", false)
  .option("--socket <socketPath>", "Custom socket path")
  .action(async (options: { all: boolean; socket?: string }) => {
    const socketPath = options.socket ?? defaultSocketPath();
    await psCommand(socketPath, options.all);
  });

program
  .command("attach")
  .argument("<runId>", "Run ID")
  .option("--socket <socketPath>", "Custom socket path")
  .action(async (runId: string, options: { socket?: string }) => {
    const socketPath = options.socket ?? defaultSocketPath();
    await attachCommand(socketPath, runId);
  });

void program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
