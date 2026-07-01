import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";
import type { ApmDaemonServer } from "./server.js";
import type { ApmEvent } from "../types/events.js";

const PACKAGE_VERSION = "0.1.0";

export interface ApmHttpServerOptions {
  host: string;
  port: number;
  token: string;
  daemon: ApmDaemonServer;
}

export class ApmHttpServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly daemon: ApmDaemonServer;
  private server?: http.Server;
  private listenPort = 0;
  private readonly sockets = new Set<Socket>();

  public constructor(options: ApmHttpServerOptions) {
    this.host = options.host;
    this.port = options.port;
    this.token = options.token;
    this.daemon = options.daemon;
  }

  public get baseUrl(): string {
    const port = this.listenPort > 0 ? this.listenPort : this.port;
    return `http://${this.host}:${port}`;
  }

  public async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => {
        this.sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        if (addr && typeof addr === "object") {
          this.listenPort = addr.port;
        } else {
          this.listenPort = this.port;
        }
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const remote = req.socket.remoteAddress ?? "";
      if (!isLoopback(remote)) {
        sendJson(res, 403, { error: "Forbidden: loopback only" });
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "OPTIONS") {
        sendEmpty(res, 204);
        return;
      }

      const queryToken = url.searchParams.get("token") ?? undefined;
      if (url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          version: PACKAGE_VERSION,
          socketPath: this.daemon.socketPath,
        });
        return;
      }

      if (!this.checkToken(req, queryToken)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (url.pathname === "/catalog" && req.method === "GET") {
        const catalog = await this.daemon.handleMethod("catalog", {});
        sendJson(res, 200, catalog);
        return;
      }

      if (url.pathname === "/desktop/summary" && req.method === "GET") {
        const summary = await this.daemon.handleMethod("desktop.summary", {});
        sendJson(res, 200, summary);
        return;
      }

      if (url.pathname === "/workflows" && req.method === "GET") {
        const workflows = await this.daemon.handleMethod("workflows", {});
        sendJson(res, 200, workflows);
        return;
      }

      const workflowMatch = url.pathname.match(/^\/workflows\/([^/]+)$/);
      if (workflowMatch && req.method === "GET") {
        const workflow = await this.daemon.handleMethod("workflow.get", {
          name: decodeURIComponent(workflowMatch[1]),
        });
        sendJson(res, 200, workflow);
        return;
      }

      const workflowValidateMatch = url.pathname.match(/^\/workflows\/([^/]+)\/validate$/);
      if (workflowValidateMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("workflow.validate", {
          name: decodeURIComponent(workflowValidateMatch[1]),
        });
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/hosts" && req.method === "GET") {
        const hosts = await this.daemon.handleMethod("hosts", {});
        sendJson(res, 200, hosts);
        return;
      }

      if (url.pathname === "/config") {
        if (req.method === "GET") {
          const config = await this.daemon.handleMethod("config.get", {});
          sendJson(res, 200, config);
          return;
        }
        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const config = await this.daemon.handleMethod("config.set", body as Record<string, unknown>);
          sendJson(res, 200, config);
          return;
        }
      }

      if (url.pathname === "/runs" && req.method === "GET") {
        const all = url.searchParams.get("all") === "true" || url.searchParams.get("all") === "1";
        const runs = await this.daemon.handleMethod("ps", { all });
        sendJson(res, 200, { runs });
        return;
      }

      if (url.pathname === "/runs" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = await this.daemon.handleMethod("run", {
          entryName: body.entryName,
          params: body.params ?? {},
          hostName: typeof body.hostName === "string" ? body.hostName : undefined,
          detach: body.detach !== false,
          attach: body.attach === true,
        });
        sendJson(res, 201, result);
        return;
      }

      if (url.pathname === "/events" && req.method === "GET") {
        const result = await this.daemon.handleMethod("events", {
          runId: url.searchParams.get("runId") ?? undefined,
          level: url.searchParams.get("level") ?? undefined,
          kind: url.searchParams.get("kind") ?? undefined,
          query: url.searchParams.get("query") ?? undefined,
          since: url.searchParams.get("since") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? "100"),
          offset: Number(url.searchParams.get("offset") ?? "0"),
        });
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/agent/apm" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = await this.daemon.handleMethod("agent.apm", body);
        sendJson(res, 200, result);
        return;
      }

      const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (runMatch && req.method === "GET") {
        const run = await this.daemon.handleMethod("run.get", { runId: runMatch[1] });
        sendJson(res, 200, { run });
        return;
      }

      const runDetailMatch = url.pathname.match(/^\/runs\/([^/]+)\/detail$/);
      if (runDetailMatch && req.method === "GET") {
        const detail = await this.daemon.handleMethod("run.detail", { runId: runDetailMatch[1] });
        sendJson(res, 200, detail);
        return;
      }

      const runPauseMatch = url.pathname.match(/^\/runs\/([^/]+)\/pause$/);
      if (runPauseMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("run.pause", { runId: runPauseMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const runResumeMatch = url.pathname.match(/^\/runs\/([^/]+)\/resume$/);
      if (runResumeMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("run.resume", { runId: runResumeMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const runDeleteMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (runDeleteMatch && req.method === "DELETE") {
        const result = await this.daemon.handleMethod("run.delete", { runId: runDeleteMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const logsMatch = url.pathname.match(/^\/runs\/([^/]+)\/logs$/);
      if (logsMatch && req.method === "GET") {
        const fromSeq = Number(url.searchParams.get("fromSeq") ?? "0");
        const kind = url.searchParams.get("kind") ?? undefined;
        const result = await this.daemon.handleMethod("logs", {
          runId: logsMatch[1],
          fromSeq: Number.isFinite(fromSeq) ? fromSeq : 0,
          kind,
        });
        sendJson(res, 200, result);
        return;
      }

      const streamMatch = url.pathname.match(/^\/runs\/([^/]+)\/events\/stream$/);
      if (streamMatch && req.method === "GET") {
        await this.handleEventStream(res, streamMatch[1], Number(url.searchParams.get("fromSeq") ?? "0"));
        return;
      }

      const attachBeginMatch = url.pathname.match(/^\/runs\/([^/]+)\/attach\/begin$/);
      if (attachBeginMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("attach.begin", { runId: attachBeginMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const attachEndMatch = url.pathname.match(/^\/runs\/([^/]+)\/attach\/end$/);
      if (attachEndMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("attach.end", { runId: attachEndMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const attachSnapshotMatch = url.pathname.match(/^\/runs\/([^/]+)\/attach\/snapshot$/);
      if (attachSnapshotMatch && req.method === "GET") {
        const snapshot = await this.daemon.handleMethod("attach.snapshot", { runId: attachSnapshotMatch[1] });
        sendJson(res, 200, snapshot);
        return;
      }

      const attachNextMatch = url.pathname.match(/^\/runs\/([^/]+)\/attach\/next$/);
      if (attachNextMatch && req.method === "POST") {
        const result = await this.daemon.handleMethod("attach.next", { runId: attachNextMatch[1] });
        sendJson(res, 200, result);
        return;
      }

      const attachMessageMatch = url.pathname.match(/^\/runs\/([^/]+)\/attach\/message$/);
      if (attachMessageMatch && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = await this.daemon.handleMethod("attach.message", {
          runId: attachMessageMatch[1],
          prompt: body.prompt,
          message: body.message,
        });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleEventStream(res: ServerResponse, runId: string, fromSeq: number): Promise<void> {
    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let seq = Number.isFinite(fromSeq) ? fromSeq : 0;
    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const watch = (await this.daemon.handleMethod("run.watch", { runId, fromSeq: seq })) as {
        run: { status: string };
        events: ApmEvent[];
        chunk: string;
        nextSeq: number;
        done: boolean;
      };
      seq = watch.nextSeq;
      writeSse(res, "watch", watch);
      if (watch.done) {
        break;
      }
      await sleep(400);
    }
    res.end();
  }

  private checkToken(req: IncomingMessage, queryToken?: string): boolean {
    if (queryToken && queryToken.trim() === this.token) {
      return true;
    }
    const auth = req.headers.authorization ?? "";
    if (auth.startsWith("Bearer ")) {
      return auth.slice(7).trim() === this.token;
    }
    const header = req.headers["x-apm-token"];
    if (typeof header === "string") {
      return header.trim() === this.token;
    }
    return false;
  }
}

function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost"
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    Connection: "close",
  });
  res.end(payload);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Length": "0",
    Connection: "close",
  });
  res.end();
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-APM-Token",
    "Access-Control-Max-Age": "86400",
  };
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
