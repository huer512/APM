#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "apm-workflow-control",
  version: "0.1.0",
});

async function main(): Promise<void> {
  server.registerTool(
  "apm",
  {
    title: "APM Workflow Control",
    description:
      "Single entrypoint for inspecting and controlling the current APM workflow run. Call apm({op,args}) with an allowed operation.",
    inputSchema: {
      op: z.string().describe("Operation name, for example help, context.current, stage_plan.update."),
      args: z.record(z.unknown()).optional().describe("Operation arguments."),
    },
  },
  async ({ op, args }) => {
    const result = await callDaemon(op, args ?? {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
  );

  await server.connect(new StdioServerTransport());
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

async function callDaemon(op: string, args: Record<string, unknown>): Promise<unknown> {
  const baseUrl = mustEnv("APM_HTTP_BASE_URL");
  const token = mustEnv("APM_HTTP_TOKEN");
  const allowedOps = new Set(
    String(process.env.APM_ALLOWED_OPS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (allowedOps.size > 0 && !allowedOps.has(op)) {
    return {
      ok: false,
      error: `Operation "${op}" is not enabled for this prompt.`,
      allowedOps: [...allowedOps],
    };
  }
  const response = await fetch(`${baseUrl}/agent/apm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op,
      args,
      context: {
        runId: process.env.APM_RUN_ID ?? "",
        stage: process.env.APM_STAGE ?? "",
        prompt: process.env.APM_PROMPT ?? "",
        allowedOps: [...allowedOps],
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
      detail: body,
    };
  }
  return body;
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required for APM MCP server.`);
  }
  return value.trim();
}
