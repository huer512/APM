import { rpcCall } from "../daemon/rpc.js";
import type { ApmEvent } from "../types/events.js";
import type { AttachSnapshot, RunRecord } from "../types.js";
import { resolveApmSocketPath } from "../utils/apm-home.js";

export function defaultSocketPath(): string {
  return resolveApmSocketPath();
}

export async function runEntry(
  socketPath: string,
  entryName: string,
  params: Record<string, unknown>,
  detach: boolean,
  attach: boolean,
): Promise<{ runId: string }> {
  return rpcCall<{ runId: string }>(socketPath, "run", { entryName, params, detach, attach });
}

export interface WatchRunResult {
  run: RunRecord;
  events: ApmEvent[];
  chunk: string;
  nextSeq: number;
  nextOffset: number;
  done: boolean;
}

export async function watchRun(
  socketPath: string,
  runId: string,
  fromSeq: number,
): Promise<WatchRunResult> {
  return rpcCall<WatchRunResult>(socketPath, "run.watch", { runId, fromSeq });
}

export async function listRuns(socketPath: string, all: boolean): Promise<RunRecord[]> {
  return rpcCall<RunRecord[]>(socketPath, "ps", { all });
}

export async function getRun(socketPath: string, runId: string): Promise<RunRecord> {
  return rpcCall<RunRecord>(socketPath, "run.get", { runId });
}

export interface ReadLogsOptions {
  fromSeq?: number;
  kind?: ApmEvent["kind"];
}

export interface ReadLogsResult {
  events: ApmEvent[];
  text: string;
}

export async function readLogs(
  socketPath: string,
  runId: string,
  options: ReadLogsOptions = {},
): Promise<ReadLogsResult> {
  return rpcCall<ReadLogsResult>(socketPath, "logs", {
    runId,
    fromSeq: options.fromSeq ?? 0,
    kind: options.kind,
  });
}

export async function attachBegin(socketPath: string, runId: string): Promise<void> {
  await rpcCall(socketPath, "attach.begin", { runId });
}

export async function attachEnd(socketPath: string, runId: string): Promise<void> {
  await rpcCall(socketPath, "attach.end", { runId });
}

export async function attachNext(socketPath: string, runId: string): Promise<void> {
  await rpcCall(socketPath, "attach.next", { runId });
}

export async function attachMessage(
  socketPath: string,
  runId: string,
  prompt: string,
  message: string,
): Promise<{ output: string }> {
  return rpcCall<{ output: string }>(socketPath, "attach.message", { runId, prompt, message });
}

export async function attachSnapshot(
  socketPath: string,
  runId: string,
): Promise<AttachSnapshot> {
  return rpcCall<AttachSnapshot>(socketPath, "attach.snapshot", { runId });
}
