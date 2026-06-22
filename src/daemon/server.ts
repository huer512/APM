import path from "node:path";
import net from "node:net";
import { promises as fs } from "node:fs";
import { formatEvents } from "../logging/format-events.js";
import { RunStore } from "../state/run-store.js";
import type { ApmEvent } from "../types/events.js";
import type {
  AttachSnapshot,
  Dict,
  EntryDefinition,
  HostDefinition,
  RunRecord,
  StageDefinition,
} from "../types.js";
import { decodeRpcLines, encodeRpc, type RpcRequest, type RpcResponse } from "./rpc.js";
import { buildCatalog, loadEntry, loadHost, loadStage, loadWorkflowBundle } from "../config/loaders.js";
import { HostExecutor } from "../engine/host-executor.js";
import { AgentRunner } from "../engine/agent-runner.js";
import { HitlController } from "../engine/hitl-controller.js";
import { WorkflowEngine } from "../engine/workflow-engine.js";
import { ensureDir } from "../utils/fs.js";
import {
  ensureApmHomeInitialized,
  ensureHttpToken,
  isNamedPipePath,
  loadApmConfig,
  loadApmConfigRaw,
  normalizeSocketPath,
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
  logs: ApmConfigFile["logs"];
  apmHome: string;
  httpBaseUrl?: string;
}

export interface DesktopSummaryResponse {
  daemon: {
    ok: boolean;
    httpBaseUrl?: string;
    apmHome: string;
    version: string;
  };
  counts: {
    workflows: number;
    runs: number;
    running: number;
    paused: number;
    finished: number;
    failed: number;
    stopped: number;
    waitingForInput: number;
    hosts: number;
  };
  recentRuns: RunRecord[];
  health: Array<{ name: string; status: "ok" | "warn" | "error"; detail: string }>;
}

export interface WorkflowSummary {
  name: string;
  path: string;
  entryStage?: string;
  host?: string;
  variables: Dict;
  description: string;
  status: "valid" | "invalid";
  error?: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  stages: Array<StageDefinition & { path: string }>;
  prompts: Array<{ name: string; path: string; model: string; body: string; metadata: Dict }>;
  hostDefinition?: HostDefinition;
}

export interface ValidationIssue {
  level: "error" | "warning" | "info";
  type: string;
  message: string;
  location: string;
  node?: string;
  status: "open" | "ignored";
}

export interface ValidationResponse {
  workflow: string;
  ok: boolean;
  checkedAt: string;
  issues: ValidationIssue[];
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
    this.socketPath = normalizeSocketPath(options.socketPath);
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
    if (!isNamedPipePath(this.socketPath)) {
      await ensureDir(path.dirname(this.socketPath));
    }
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
      case "events":
        return this.listEvents(params);
      case "catalog":
        return this.getCatalog();
      case "desktop.summary":
        return this.getDesktopSummary();
      case "workflows":
        return this.listWorkflows();
      case "workflow.get":
        return this.getWorkflow(asString(params.name, "name"));
      case "workflow.validate":
        return this.validateWorkflow(asString(params.name, "name"));
      case "hosts":
        return this.listHosts();
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
      case "run.detail":
        return this.getRunDetail(asString(params.runId, "runId"));
      case "run.stop":
        return this.stopRun(asString(params.runId, "runId"));
      case "run.retry":
        return this.retryRun(asString(params.runId, "runId"));
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
      logs: config.logs,
      apmHome: this.root,
      httpBaseUrl: listen.enabled ? (this.httpServer?.baseUrl ?? `http://${listen.host}:${listen.port}`) : undefined,
    };
  }

  private async getDesktopSummary(): Promise<DesktopSummaryResponse> {
    const [catalog, config, runs] = await Promise.all([
      buildCatalog(this.root),
      this.getConfig(),
      this.store.listRuns(true),
    ]);
    const counts = {
      workflows: catalog.entries.size,
      runs: runs.length,
      running: runs.filter((run) => run.status === "running").length,
      paused: runs.filter((run) => run.status === "paused").length,
      finished: runs.filter((run) => run.status === "finished").length,
      failed: runs.filter((run) => run.status === "failed").length,
      stopped: runs.filter((run) => run.status === "stopped").length,
      waitingForInput: runs.filter((run) => run.waitingForNext || run.attachMode).length,
      hosts: catalog.hosts.size,
    };
    const health: DesktopSummaryResponse["health"] = [
      {
        name: "Daemon 服务",
        status: "ok",
        detail: "运行中",
      },
      {
        name: "HTTP API",
        status: config.http?.enabled ? "ok" : "warn",
        detail: config.httpBaseUrl ?? "未启用",
      },
      {
        name: "Cursor API Key",
        status: config.hasApiKey ? "ok" : "warn",
        detail: config.hasApiKey ? "已配置" : "未配置",
      },
      {
        name: "APM_HOME",
        status: "ok",
        detail: this.root,
      },
      {
        name: "工作流配置目录",
        status: counts.workflows > 0 ? "ok" : "warn",
        detail: counts.workflows > 0 ? `${counts.workflows} 个工作流` : "暂无 entries",
      },
    ];
    return {
      daemon: {
        ok: true,
        httpBaseUrl: config.httpBaseUrl,
        apmHome: this.root,
        version: "0.1.0",
      },
      counts,
      recentRuns: runs.slice(0, 6),
      health,
    };
  }

  private async listWorkflows(): Promise<{ workflows: WorkflowSummary[] }> {
    const catalog = await buildCatalog(this.root);
    const workflows: WorkflowSummary[] = [];
    for (const [name, filePath] of catalog.entries.entries()) {
      try {
        const entry = await loadEntry(name, filePath);
        workflows.push({
          name,
          path: path.relative(this.root, filePath),
          entryStage: entry.entry,
          host: entry.host,
          variables: entry.variables,
          description: entry.description,
          status: "valid",
        });
      } catch (error) {
        workflows.push({
          name,
          path: path.relative(this.root, filePath),
          variables: {},
          description: "",
          status: "invalid",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    workflows.sort((a, b) => a.name.localeCompare(b.name));
    return { workflows };
  }

  private async getWorkflow(name: string): Promise<{ workflow: WorkflowDetail }> {
    const catalog = await buildCatalog(this.root);
    const entryPath = mustCatalog(catalog.entries, name, "entry");
    const entry = await loadEntry(name, entryPath);
    const bundle = await loadWorkflowBundle(this.root, name);
    return {
      workflow: {
        name,
        path: path.relative(this.root, entryPath),
        entryStage: entry.entry,
        host: entry.host,
        variables: entry.variables,
        description: entry.description,
        status: "valid",
        stages: [...bundle.stages.values()].map((stage) => ({
          ...stage,
          path: path.relative(this.root, stage.path),
        })),
        prompts: [...bundle.prompts.values()].map((prompt) => ({
          ...prompt,
          path: path.relative(this.root, prompt.path),
        })),
        hostDefinition: {
          ...bundle.host,
          path: path.relative(this.root, bundle.host.path),
        },
      },
    };
  }

  private async validateWorkflow(name: string): Promise<ValidationResponse> {
    const issues: ValidationIssue[] = [];
    try {
      const { workflow } = await this.getWorkflow(name);
      if (Object.keys(workflow.variables).length === 0) {
        issues.push({
          level: "info",
          type: "variables",
          message: "工作流未声明运行参数",
          location: workflow.path,
          status: "ignored",
        });
      }
      for (const stage of workflow.stages) {
        if (stage.prompts.length === 0) {
          issues.push({
            level: "error",
            type: "stage.prompts",
            message: `阶段 "${stage.name}" 没有提示词`,
            location: stage.path,
            node: stage.name,
            status: "open",
          });
        }
      }
    } catch (error) {
      issues.push({
        level: "error",
        type: "workflow.load",
        message: error instanceof Error ? error.message : String(error),
        location: `entries/${name}.md`,
        status: "open",
      });
    }
    return {
      workflow: name,
      ok: !issues.some((issue) => issue.level === "error"),
      checkedAt: new Date().toISOString(),
      issues,
    };
  }

  private async listHosts(): Promise<{ hosts: Array<HostDefinition & { status: "local" | "configured"; path: string }> }> {
    const catalog = await buildCatalog(this.root);
    const hosts = [];
    for (const [name, filePath] of catalog.hosts.entries()) {
      const host = await loadHost(name, filePath, this.root);
      const status: "local" | "configured" =
        host.host === "localhost" || host.host === "127.0.0.1" ? "local" : "configured";
      hosts.push({
        ...host,
        path: path.relative(this.root, host.path),
        status,
      });
    }
    hosts.sort((a, b) => a.name.localeCompare(b.name));
    return { hosts };
  }

  private async setConfig(params: Record<string, unknown>): Promise<ConfigGetResponse> {
    const patch: ApmConfigFile = {};
    if (typeof params.cursorApiKey === "string") {
      patch.cursorApiKey = params.cursorApiKey;
    }
    if (params.http && typeof params.http === "object") {
      patch.http = params.http as ApmConfigFile["http"];
    }
    if (params.logs && typeof params.logs === "object") {
      patch.logs = params.logs as ApmConfigFile["logs"];
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
    const hostName = typeof params.hostName === "string" && params.hostName.trim().length > 0
      ? params.hostName.trim()
      : undefined;
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

    void this.executeRun(runId, entryName, hostName).catch(async (error) => {
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
    const done = run.status === "finished" || run.status === "failed" || run.status === "stopped";
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

  private async listEvents(params: Record<string, unknown>): Promise<{ events: ApmEvent[]; total: number }> {
    const config = await loadApmConfig(this.root);
    const configuredLimit = Number(config.logs?.defaultLimit ?? 200);
    const retentionDays = Number(config.logs?.retentionDays ?? 30);
    const since = typeof params.since === "string" && params.since.trim().length > 0
      ? params.since.trim()
      : retentionDays > 0
        ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
    const limit = asNumber(params.limit, "limit", Number.isFinite(configuredLimit) ? configuredLimit : 200);
    const offset = asNumber(params.offset, "offset", 0);
    const runId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : undefined;
    const level = typeof params.level === "string" && params.level.trim()
      ? (params.level.trim() as ApmEvent["level"])
      : undefined;
    const kind = typeof params.kind === "string" && params.kind.trim()
      ? (params.kind.trim() as ApmEvent["kind"])
      : undefined;
    const query = typeof params.query === "string" ? params.query : undefined;
    return this.store.listEvents({ runId, level, kind, query, since, limit, offset });
  }

  private async getRunDetail(runId: string): Promise<{
    run: RunRecord;
    events: ApmEvent[];
    stages: Array<{ name: string; status: string; prompts: string[]; durationMs?: number }>;
    tools: ApmEvent[];
    messages: RunRecord["messageHistory"];
    failure?: { message: string; stage?: string; prompt?: string };
  }> {
    const run = await mustRun(this.store, runId);
    const events = await this.store.readEvents(runId, 0);
    const stageNames = new Set<string>();
    for (const event of events) {
      if (event.stage) {
        stageNames.add(event.stage);
      }
    }
    for (const item of run.promptHistory) {
      stageNames.add(item.stage);
    }
    if (run.currentStage) {
      stageNames.add(run.currentStage);
    }
    const stages = [...stageNames].map((stageName) => {
      const prompts = [
        ...new Set([
          ...run.promptHistory.filter((item) => item.stage === stageName).map((item) => item.prompt),
          ...run.messageHistory.filter((item) => item.stage === stageName).map((item) => item.prompt),
        ]),
      ];
      return {
        name: stageName,
        status: run.currentStage === stageName ? run.status : "completed",
        prompts,
      };
    });
    const lastError = [...events].reverse().find((event) => event.level === "error");
    return {
      run,
      events,
      stages,
      tools: events.filter((event) => event.kind === "tool"),
      messages: run.messageHistory,
      failure: run.error || lastError
        ? {
            message: run.error ?? String(lastError?.data.error ?? lastError?.data.detail ?? "运行失败"),
            stage: lastError?.stage ?? run.currentStage,
            prompt: lastError?.prompt ?? run.currentPrompt,
          }
        : undefined,
    };
  }

  private async stopRun(runId: string): Promise<{ run: RunRecord }> {
    const run = await mustRun(this.store, runId);
    if (run.status !== "running" && run.status !== "paused") {
      return { run };
    }
    await this.runner.closeByPrefix(`${runId}.`);
    const updated = await this.store.updateRun(runId, {
      status: "stopped",
      finishedAt: new Date().toISOString(),
      waitingForNext: false,
      activeBatch: [],
      error: "Stopped by user",
    });
    await this.store.appendEvent(runId, {
      runId,
      level: "warn",
      kind: "run",
      data: { action: "stopped", detail: "Stopped by user" },
    });
    return { run: updated };
  }

  private async retryRun(runId: string): Promise<{ runId: string }> {
    const run = await mustRun(this.store, runId);
    return this.handleRun({
      entryName: run.entryName,
      params: run.variables,
      attach: run.attachMode,
      detach: true,
    });
  }

  private async executeRun(runId: string, entryName: string, hostName?: string): Promise<void> {
    try {
      const run = await this.store.getRun(runId);
      if (!run) {
        throw new Error(`Run "${runId}" disappeared.`);
      }
      const bundle = await loadWorkflowBundle(this.root, entryName, { hostName });
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
    const run = await mustRun(this.store, runId);
    this.hitl.setAttached(runId, false);
    await this.store.updateRun(runId, { attachMode: false });
    if (run.waitingForNext) {
      const batchKey = (run.activeBatch ?? []).slice().sort().join(",");
      if (batchKey.length > 0) {
        this.hitl.moveBatch(runId, batchKey);
      } else {
        this.hitl.moveNext(runId);
      }
    }
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

function mustCatalog(map: Map<string, string>, name: string, kind: string): string {
  const found = map.get(name);
  if (!found) {
    throw new Error(`Cannot find ${kind} "${name}" in configured directory.`);
  }
  return found;
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
