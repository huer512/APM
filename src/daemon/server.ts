import path from "node:path";
import net from "node:net";
import { promises as fs } from "node:fs";
import { formatEvents } from "../logging/format-events.js";
import { RunStore } from "../state/run-store.js";
import type { ApmEvent } from "../types/events.js";
import type { AttachSnapshot, Dict, RunRecord } from "../types.js";
import { decodeRpcLines, encodeRpc, type RpcRequest, type RpcResponse } from "./rpc.js";
import { buildCatalog, loadWorkflowBundle } from "../config/loaders.js";
import { HostExecutor } from "../engine/host-executor.js";
import { AgentRunner } from "../engine/agent-runner.js";
import { HitlController } from "../engine/hitl-controller.js";
import { WorkflowEngine } from "../engine/workflow-engine.js";
import { ensureDir } from "../utils/fs.js";
import {
  ensureApmHomeInitialized,
  ensureHttpToken,
  loadApmConfig,
  loadApmConfigRaw,
  resolveHttpListen,
  saveApmConfig,
  type ApmConfigFile,
} from "../utils/apm-home.js";
import { ApmHttpServer } from "./http-server.js";

interface DaemonOptions {
  workspaceRoot: string;
  socketPath: string;
}

export interface CatalogResponse {
  prompts: Array<{ name: string; path: string }>;
  stages: Array<{ name: string; path: string }>;
  hosts: Array<{ name: string; path: string }>;
  entries: Array<{ name: string; path: string }>;
}

export interface ConfigGetResponse {
  cursorApiKey: string;
  hasApiKey: boolean;
  http: ApmConfigFile["http"];
  apmHome: string;
  httpBaseUrl?: string;
}

export class ApmDaemonServer {
  private readonly root: string;
  public readonly socketPath: string;
  private readonly store: RunStore;
  private readonly runner: AgentRunner;
  private readonly engine: WorkflowEngine;
  private readonly hitl: HitlController;
  private server?: net.Server;
  private httpServer?: ApmHttpServer;
  private cursorApiKey?: string;
  private httpToken?: string;

  public constructor(options: DaemonOptions) {
    this.root = options.workspaceRoot;
    this.socketPath = options.socketPath;
    this.store = new RunStore(path.join(this.root, "state"));
    this.runner = new AgentRunner({
      apiKeyProvider: () => this.cursorApiKey,
    });
    this.hitl = new HitlController();
    this.engine = new WorkflowEngine({
      store: this.store,
      hostExecutor: new HostExecutor(),
      runner: this.runner,
      hitl: this.hitl,
    });
  }

  public async start(): Promise<void> {
    await ensureApmHomeInitialized(this.root);
    const config = await loadApmConfig(this.root);
    this.cursorApiKey = config.cursorApiKey;
    this.httpToken = await ensureHttpToken(this.root);
    await ensureDir(path.dirname(this.socketPath));
    await this.store.init();
    await this.safeUnlinkSocket();
    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server
        ?.on("error", reject)
        .listen(this.socketPath, () => resolve());
    });

    const listen = resolveHttpListen(this.root, config);
    if (listen.enabled) {
      this.httpServer = new ApmHttpServer({
        host: listen.host,
        port: listen.port,
        token: this.httpToken,
        daemon: this,
      });
      await this.httpServer.start();
    }
  }

  public async stop(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = undefined;
    }
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server?.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await this.runner.closeAll();
    await this.safeUnlinkSocket();
  }

  public getHttpInfo(): { baseUrl?: string; token?: string } {
    return {
      baseUrl: this.httpServer?.baseUrl,
      token: this.httpToken,
    };
  }

  private async safeUnlinkSocket(): Promise<void> {
    try {
      await fs.unlink(this.socketPath);
    } catch {
      // Ignore missing socket.
    }
  }

  private handleSocket(socket: net.Socket): void {
    let buffer = "";
    socket.on("data", async (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const { messages, rest } = decodeRpcLines(buffer);
      buffer = rest;
      for (const request of messages) {
        const response = await this.dispatch(request);
        socket.write(encodeRpc(response));
      }
    });
  }

  private async dispatch(request: RpcRequest): Promise<RpcResponse> {
    try {
      const result = await this.handleMethod(request.method, request.params ?? {});
      return { id: request.id, ok: true, result };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async handleMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "run":
        return this.handleRun(params);
      case "run.get":
        return this.getRun(asString(params.runId, "runId"));
      case "run.watch":
        return this.watchRun(
          asString(params.runId, "runId"),
          asNumber(params.fromSeq ?? params.offset, "fromSeq", 0),
        );
      case "ps":
        return this.store.listRuns(Boolean(params.all));
      case "logs":
        return this.readLogsRpc(params);
      case "catalog":
        return this.getCatalog();
      case "config.get":
        return this.getConfig();
      case "config.set":
        return this.setConfig(params);
      case "attach.begin":
        return this.attachBegin(asString(params.runId, "runId"));
      case "attach.end":
        return this.attachEnd(asString(params.runId, "runId"));
      case "attach.snapshot":
        return this.attachSnapshot(asString(params.runId, "runId"));
      case "attach.next":
        return this.attachNext(asString(params.runId, "runId"));
      case "attach.message":
        return this.attachMessage(
          asString(params.runId, "runId"),
          asString(params.prompt, "prompt"),
          asString(params.message, "message"),
        );
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  private async getRun(runId: string): Promise<RunRecord> {
    return mustRun(this.store, runId);
  }

  private async getCatalog(): Promise<CatalogResponse> {
    const catalog = await buildCatalog(this.root);
    return {
      prompts: mapToList(catalog.prompts, this.root),
      stages: mapToList(catalog.stages, this.root),
      hosts: mapToList(catalog.hosts, this.root),
      entries: mapToList(catalog.entries, this.root),
    };
  }

  private async getConfig(): Promise<ConfigGetResponse> {
    const raw = await loadApmConfigRaw(this.root);
    const config = await loadApmConfig(this.root);
    const listen = resolveHttpListen(this.root, config);
    const key = raw.cursorApiKey ?? "";
    return {
      cursorApiKey: key,
      hasApiKey: key.trim().length > 0,
      http: config.http,
      apmHome: this.root,
      httpBaseUrl: listen.enabled ? `http://${listen.host}:${listen.port}` : undefined,
    };
  }

  private async setConfig(params: Record<string, unknown>): Promise<ConfigGetResponse> {
    const patch: ApmConfigFile = {};
    if (typeof params.cursorApiKey === "string") {
      patch.cursorApiKey = params.cursorApiKey;
    }
    if (params.http && typeof params.http === "object") {
      patch.http = params.http as ApmConfigFile["http"];
    }
    await saveApmConfig(this.root, patch);
    const config = await loadApmConfig(this.root);
    this.cursorApiKey = config.cursorApiKey;

    const listen = resolveHttpListen(this.root, config);
    if (listen.enabled && !this.httpServer) {
      this.httpToken = await ensureHttpToken(this.root);
      this.httpServer = new ApmHttpServer({
        host: listen.host,
        port: listen.port,
        token: this.httpToken,
        daemon: this,
      });
      await this.httpServer.start();
    } else if (!listen.enabled && this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = undefined;
    }

    return this.getConfig();
  }

  private async handleRun(params: Record<string, unknown>): Promise<{ runId: string }> {
    const config = await loadApmConfig(this.root);
    this.cursorApiKey = config.cursorApiKey;
    const entryName = asString(params.entryName, "entryName");
    const variables = (params.params as Dict) ?? {};
    const attach = params.attach === true;
    const runId = createRunId();
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: runId,
      entryName,
      hostName: "",
      status: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      attachMode: attach,
      waitingForNext: false,
      activeBatch: [],
      variables,
      promptHistory: [],
      messageHistory: [],
    };
    await this.store.createRun(run);

    if (attach) {
      this.hitl.setAttached(runId, true);
    }

    void this.executeRun(runId, entryName).catch(async (error) => {
      await this.store.updateRun(runId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
        activeBatch: [],
      });
      await this.store.appendEvent(runId, {
        runId,
        level: "error",
        kind: "run",
        data: { action: "failed", error: String(error) },
      });
    });

    return { runId };
  }

  private async watchRun(runId: string, fromSeq: number): Promise<{
    run: RunRecord;
    events: ApmEvent[];
    chunk: string;
    nextSeq: number;
    nextOffset: number;
    done: boolean;
  }> {
    const run = await mustRun(this.store, runId);
    const { events, chunk, nextSeq } = await this.store.readLogsSlice(runId, fromSeq);
    const done = run.status === "finished" || run.status === "failed";
    return {
      run,
      events,
      chunk,
      nextSeq,
      nextOffset: nextSeq,
      done,
    };
  }

  private async readLogsRpc(params: Record<string, unknown>): Promise<{ events: ApmEvent[]; text: string }> {
    const runId = asString(params.runId, "runId");
    const fromSeq = asNumber(params.fromSeq, "fromSeq", 0);
    const kind = typeof params.kind === "string" ? (params.kind as ApmEvent["kind"]) : undefined;
    const events = await this.store.readEvents(runId, fromSeq, undefined, kind);
    return {
      events,
      text: formatEvents(events),
    };
  }

  private async executeRun(runId: string, entryName: string): Promise<void> {
    try {
      const run = await this.store.getRun(runId);
      if (!run) {
        throw new Error(`Run "${runId}" disappeared.`);
      }
      const bundle = await loadWorkflowBundle(this.root, entryName);
      await this.store.updateRun(runId, { hostName: bundle.host.name });
      await this.store.appendEvent(runId, {
        runId,
        level: "info",
        kind: "run",
        data: { action: "start", detail: `entry=${entryName}` },
      });
      await this.engine.execute(bundle, run);
    } finally {
      await this.runner.closeByPrefix(`${runId}.`);
    }
  }

  private async attachBegin(runId: string): Promise<{ ok: true }> {
    await mustRun(this.store, runId);
    this.hitl.setAttached(runId, true);
    await this.store.updateRun(runId, { attachMode: true });
    return { ok: true };
  }

  private async attachEnd(runId: string): Promise<{ ok: true }> {
    await mustRun(this.store, runId);
    this.hitl.setAttached(runId, false);
    await this.store.updateRun(runId, { attachMode: false });
    return { ok: true };
  }

  private async attachSnapshot(runId: string): Promise<AttachSnapshot> {
    const run = await mustRun(this.store, runId);
    const recentEvents = await this.store.readEventsTail(runId, 60);
    const logs = formatEvents(recentEvents);
    const promptHistoryByStage: AttachSnapshot["promptHistoryByStage"] = {};
    const messageHistoryByStagePrompt: AttachSnapshot["messageHistoryByStagePrompt"] = {};
    const stagePrompts: AttachSnapshot["stagePrompts"] = {};

    for (const item of run.promptHistory) {
      promptHistoryByStage[item.stage] = promptHistoryByStage[item.stage] ?? [];
      promptHistoryByStage[item.stage]?.push(item);
      stagePrompts[item.stage] = stagePrompts[item.stage] ?? [];
      if (!stagePrompts[item.stage]?.includes(item.prompt)) {
        stagePrompts[item.stage]?.push(item.prompt);
      }
    }

    for (const item of run.messageHistory) {
      const key = `${item.stage}.${item.prompt}`;
      messageHistoryByStagePrompt[key] = messageHistoryByStagePrompt[key] ?? [];
      messageHistoryByStagePrompt[key]?.push(item);
      stagePrompts[item.stage] = stagePrompts[item.stage] ?? [];
      if (!stagePrompts[item.stage]?.includes(item.prompt)) {
        stagePrompts[item.stage]?.push(item.prompt);
      }
    }

    return {
      run,
      logs,
      recentEvents,
      stagePrompts,
      promptHistoryByStage,
      messageHistoryByStagePrompt,
    };
  }

  private async attachNext(runId: string): Promise<{ ok: true }> {
    const run = await mustRun(this.store, runId);
    const batchKey = (run.activeBatch ?? []).slice().sort().join(",");
    if (batchKey.length > 0) {
      this.hitl.moveBatch(runId, batchKey);
    } else {
      this.hitl.moveNext(runId);
    }
    return { ok: true };
  }

  private async attachMessage(runId: string, prompt: string, message: string): Promise<{ output: string }> {
    await mustRun(this.store, runId);
    const output = await this.hitl.sendMessage(runId, prompt, message);
    return { output };
  }
}

async function mustRun(store: RunStore, runId: string): Promise<RunRecord> {
  const run = await store.getRun(runId);
  if (!run) {
    throw new Error(`Run "${runId}" not found.`);
  }
  return run;
}

function mapToList(map: Map<string, string>, root: string): Array<{ name: string; path: string }> {
  return [...map.entries()]
    .map(([name, filePath]) => ({
      name,
      path: path.relative(root, filePath),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing "${field}".`);
  }
  return value.trim();
}

function asNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Invalid "${field}", expected number.`);
}

function createRunId(): string {
  return Math.random().toString(16).slice(2, 14);
}
