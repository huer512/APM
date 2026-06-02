export const APM_EVENT_SCHEMA_VERSION = 1;

export type ApmEventKind =
  | "run"
  | "entry"
  | "stage"
  | "prompt"
  | "message"
  | "tool"
  | "thinking"
  | "hitl";

export type ApmEventLevel = "debug" | "info" | "warn" | "error";

export interface ApmEvent {
  v: typeof APM_EVENT_SCHEMA_VERSION;
  seq: number;
  ts: string;
  runId: string;
  level: ApmEventLevel;
  kind: ApmEventKind;
  stage?: string;
  prompt?: string;
  sessionKey?: string;
  sdkRunId?: string;
  data: Record<string, unknown>;
}

export type ApmEventInput = Omit<ApmEvent, "v" | "seq" | "ts"> & {
  ts?: string;
};
