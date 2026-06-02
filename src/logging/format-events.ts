import type { ApmEvent } from "../types/events.js";

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatToolEvent(event: ApmEvent): string {
  const name = String(event.data.name ?? "unknown");
  const status = String(event.data.status ?? "unknown");
  if (status === "running") {
    const args = stringifyValue(event.data.args);
    return args.length > 0 ? `[TOOL] ${name} running args=${args}` : `[TOOL] ${name} running`;
  }
  if (status === "completed" || status === "error") {
    const result = stringifyValue(event.data.result);
    return result.length > 0
      ? `[TOOL] ${name} ${status} result=${result}`
      : `[TOOL] ${name} ${status}`;
  }
  return `[TOOL] ${name} ${status}`;
}

export function formatEvent(event: ApmEvent): string {
  switch (event.kind) {
    case "run": {
      const action = String(event.data.action ?? "event");
      const detail = event.data.detail ? ` ${String(event.data.detail)}` : "";
      if (event.data.error) {
        return `[RUN] ${action}${detail}: ${String(event.data.error)}`;
      }
      return `[RUN] ${action}${detail}`;
    }
    case "entry":
      return `[ENTRY] ${String(event.data.description ?? "")}`;
    case "stage": {
      const action = String(event.data.action ?? "event");
      if (action === "enter") {
        return `[STAGE] Enter ${event.stage ?? ""}`;
      }
      if (action === "body") {
        return `[STAGE] Body ${String(event.data.body ?? "")}`;
      }
      return `[STAGE] ${action} ${event.stage ?? ""}`;
    }
    case "prompt": {
      const action = String(event.data.action ?? "event");
      const sessionKey = event.sessionKey ?? `${event.stage ?? ""}.${event.prompt ?? ""}`;
      if (action === "started") {
        return `[PROMPT] ${sessionKey} started`;
      }
      if (action === "completed") {
        return `[PROMPT] ${sessionKey} output: ${String(event.data.output ?? "")}`;
      }
      if (action === "error") {
        return `[PROMPT] ${sessionKey} error: ${String(event.data.error ?? "")}`;
      }
      return `[PROMPT] ${sessionKey} ${action}`;
    }
    case "message":
      return `[MSG][${event.data.role ?? "?"}] ${String(event.data.content ?? "")}`;
    case "tool":
      return formatToolEvent(event);
    case "thinking":
      return `[THINKING] ${String(event.data.text ?? "")}`;
    case "hitl": {
      const action = String(event.data.action ?? "event");
      if (action === "batch_wait") {
        return `[HITL] Batch ${String(event.data.batchKey ?? "")} waiting for manual next`;
      }
      if (action === "follow_up") {
        return `[HITL][${event.sessionKey ?? ""}] ${String(event.data.output ?? "")}`;
      }
      return `[HITL] ${action}`;
    }
    default:
      return `[${event.kind}] ${stringifyValue(event.data)}`;
  }
}

export function formatEvents(events: ApmEvent[]): string {
  return events.map(formatEvent).join("\n");
}

export function formatToolMessageSummary(event: ApmEvent): string {
  const name = String(event.data.name ?? "tool");
  const status = String(event.data.status ?? "unknown");
  if (status === "running") {
    return `[tool:${name}] running ${stringifyValue(event.data.args)}`;
  }
  return `[tool:${name}] ${status} ${stringifyValue(event.data.result ?? event.data.args)}`;
}
