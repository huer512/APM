import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureDir, pathExists } from "../utils/fs.js";
import { formatEvents } from "../logging/format-events.js";
import type { ApmEvent, ApmEventInput } from "../types/events.js";
import { APM_EVENT_SCHEMA_VERSION } from "../types/events.js";
import type { RunRecord, RunStatus } from "../types.js";

interface RunStorePayload {
  runs: RunRecord[];
}

export class RunStore {
  private readonly rootDir: string;
  private readonly runsFile: string;
  private readonly eventsDir: string;
  private readonly seqCache = new Map<string, number>();
  private payloadLock: Promise<void> = Promise.resolve();

  public constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.runsFile = path.join(rootDir, "runs.json");
    this.eventsDir = path.join(rootDir, "events");
  }

  public async init(): Promise<void> {
    await ensureDir(this.rootDir);
    await ensureDir(this.eventsDir);
    if (!(await pathExists(this.runsFile))) {
      await fs.writeFile(this.runsFile, JSON.stringify({ runs: [] }, null, 2), "utf8");
    }
  }

  public async createRun(run: RunRecord): Promise<void> {
    await this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      payload.runs.push(run);
      await this.writePayloadUnsafe(payload);
    });
  }

  public async updateRun(runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    return this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      const idx = payload.runs.findIndex((item) => item.id === runId);
      if (idx < 0) {
        throw new Error(`Run "${runId}" not found.`);
      }
      const updated = {
        ...payload.runs[idx],
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      payload.runs[idx] = updated;
      await this.writePayloadUnsafe(payload);
      return updated;
    });
  }

  public async appendPromptHistory(runId: string, item: RunRecord["promptHistory"][number]): Promise<void> {
    await this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      const run = payload.runs.find((entry) => entry.id === runId);
      if (!run) {
        throw new Error(`Run "${runId}" not found.`);
      }
      run.promptHistory.push(item);
      run.updatedAt = new Date().toISOString();
      await this.writePayloadUnsafe(payload);
    });
  }

  public async appendMessageHistory(runId: string, item: RunRecord["messageHistory"][number]): Promise<void> {
    await this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      const run = payload.runs.find((entry) => entry.id === runId);
      if (!run) {
        throw new Error(`Run "${runId}" not found.`);
      }
      run.messageHistory.push(item);
      run.updatedAt = new Date().toISOString();
      await this.writePayloadUnsafe(payload);
    });
  }

  public async updateStatus(runId: string, status: RunStatus, patch?: Partial<RunRecord>): Promise<RunRecord> {
    return this.updateRun(runId, { ...(patch ?? {}), status });
  }

  public async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      return payload.runs.find((item) => item.id === runId);
    });
  }

  public async listRuns(includeAll: boolean): Promise<RunRecord[]> {
    return this.withPayloadLock(async () => {
      const payload = await this.readPayloadUnsafe();
      if (includeAll) {
        return payload.runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      return payload.runs
        .filter((run) => run.status === "running" || run.status === "paused")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  public async appendEvent(runId: string, input: ApmEventInput): Promise<ApmEvent> {
    await this.init();
    const seq = (this.seqCache.get(runId) ?? (await this.getEventCount(runId))) + 1;
    const event: ApmEvent = {
      v: APM_EVENT_SCHEMA_VERSION,
      seq,
      ts: input.ts ?? new Date().toISOString(),
      runId: input.runId,
      level: input.level,
      kind: input.kind,
      stage: input.stage,
      prompt: input.prompt,
      sessionKey: input.sessionKey,
      sdkRunId: input.sdkRunId,
      data: input.data,
    };
    const file = this.eventPath(runId);
    await fs.appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
    this.seqCache.set(runId, seq);
    try {
      await this.updateRun(runId, { lastEventSeq: seq });
    } catch {
      // Run record may not exist yet during low-level event writes.
    }
    return event;
  }

  public async readEvents(runId: string, fromSeq = 0, limit?: number, kind?: ApmEvent["kind"]): Promise<ApmEvent[]> {
    const all = await this.readAllEvents(runId);
    let filtered = all.filter((event) => event.seq > fromSeq);
    if (kind) {
      filtered = filtered.filter((event) => event.kind === kind);
    }
    if (typeof limit === "number" && limit >= 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  public async readEventsTail(runId: string, limit: number): Promise<ApmEvent[]> {
    const all = await this.readAllEvents(runId);
    if (limit <= 0) {
      return [];
    }
    return all.slice(-limit);
  }

  public async getEventCount(runId: string): Promise<number> {
    const cached = this.seqCache.get(runId);
    if (cached !== undefined) {
      return cached;
    }
    const all = await this.readAllEvents(runId);
    const maxSeq = all.length > 0 ? all[all.length - 1]!.seq : 0;
    this.seqCache.set(runId, maxSeq);
    return maxSeq;
  }

  /** @deprecated Use appendEvent instead. Kept as compatibility wrapper. */
  public async appendLog(runId: string, line: string): Promise<void> {
    await this.appendEvent(runId, {
      runId,
      level: "info",
      kind: "run",
      data: { action: "legacy_log", detail: line },
    });
  }

  public async readLogs(runId: string): Promise<string> {
    const events = await this.readAllEvents(runId);
    return formatEvents(events);
  }

  public async readLogsSlice(runId: string, fromSeq: number): Promise<{
    events: ApmEvent[];
    chunk: string;
    nextSeq: number;
  }> {
    const events = await this.readEvents(runId, fromSeq);
    return {
      events,
      chunk: formatEvents(events),
      nextSeq: await this.getEventCount(runId),
    };
  }

  private eventPath(runId: string): string {
    return path.join(this.eventsDir, `${runId}.jsonl`);
  }

  private async readAllEvents(runId: string): Promise<ApmEvent[]> {
    await this.init();
    const file = this.eventPath(runId);
    if (!(await pathExists(file))) {
      return [];
    }
    const raw = await fs.readFile(file, "utf8");
    if (raw.trim().length === 0) {
      return [];
    }
    const events: ApmEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      events.push(JSON.parse(line) as ApmEvent);
    }
    return events.sort((a, b) => a.seq - b.seq);
  }

  private async withPayloadLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.payloadLock;
    this.payloadLock = previous.then(() => gate);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async readPayloadUnsafe(): Promise<RunStorePayload> {
    await this.init();
    const raw = await fs.readFile(this.runsFile, "utf8");
    try {
      return JSON.parse(raw) as RunStorePayload;
    } catch (error) {
      const salvaged = salvageRunsPayload(raw);
      if (salvaged) {
        await this.writePayloadUnsafe(salvaged);
        return salvaged;
      }
      const backupPath = `${this.runsFile}.corrupt-${Date.now()}`;
      await fs.rename(this.runsFile, backupPath);
      const empty: RunStorePayload = { runs: [] };
      await this.writePayloadUnsafe(empty);
      throw new Error(
        `Corrupt runs store at ${this.runsFile}; backed up to ${backupPath}. ${String(error)}`,
      );
    }
  }

  private async writePayloadUnsafe(payload: RunStorePayload): Promise<void> {
    const tmp = `${this.runsFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tmp, this.runsFile);
  }
}

function salvageRunsPayload(raw: string): RunStorePayload | undefined {
  const splitIndex = raw.indexOf("}{");
  if (splitIndex >= 0) {
    try {
      const first = JSON.parse(raw.slice(0, splitIndex + 1)) as RunStorePayload;
      if (Array.isArray(first.runs)) {
        return first;
      }
    } catch {
      // Fall through to full parse attempts.
    }
  }

  for (let end = raw.length; end > 0; end -= 1) {
    if (raw[end - 1] !== "}") {
      continue;
    }
    try {
      const candidate = JSON.parse(raw.slice(0, end)) as RunStorePayload;
      if (Array.isArray(candidate.runs)) {
        return candidate;
      }
    } catch {
      // Keep scanning for a valid prefix.
    }
  }

  return undefined;
}
