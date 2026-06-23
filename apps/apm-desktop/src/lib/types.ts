export interface RunRecord {
  id: string;
  entryName: string;
  hostName: string;
  status: "running" | "paused" | "finished" | "failed" | "stopped";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStage?: string;
  currentPrompt?: string;
  activeBatch: string[];
  attachMode: boolean;
  waitingForNext: boolean;
  error?: string;
}

export interface ApmEvent {
  seq: number;
  runId: string;
  ts: string;
  level: string;
  kind: string;
  stage?: string;
  prompt?: string;
  sessionKey?: string;
  sdkRunId?: string;
  data: Record<string, unknown>;
}

export interface CatalogItem {
  name: string;
  path: string;
}

export interface Catalog {
  prompts: CatalogItem[];
  stages: CatalogItem[];
  hosts: CatalogItem[];
  entries: CatalogItem[];
}

export interface ConfigResponse {
  cursorApiKey: string;
  hasApiKey: boolean;
  http?: {
    enabled?: boolean;
    host?: string;
    port?: number;
  };
  logs?: {
    retentionDays?: number;
    defaultLimit?: number;
    collectDebug?: boolean;
    collectThinking?: boolean;
    collectToolDetails?: boolean;
    collectStageBody?: boolean;
    collectPromptOutput?: boolean;
    collectMessages?: boolean;
  };
  apmHome: string;
  httpBaseUrl?: string;
}

export interface DesktopSummary {
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
  variables: Record<string, unknown>;
  description: string;
  status: "valid" | "invalid";
  error?: string;
}

export interface StageDefinition {
  name: string;
  path: string;
  prompts: string[];
  nextStages: string[];
  rawBody: string;
}

export interface PromptDefinition {
  name: string;
  path: string;
  model: string;
  metadata: Record<string, unknown>;
  body: string;
}

export interface HostDefinition {
  name: string;
  path: string;
  host: string;
  port?: number;
  username?: string;
  virtualEnv?: string;
  workspace: string;
  status?: "local" | "configured";
}

export interface WorkflowDetail extends WorkflowSummary {
  stages: StageDefinition[];
  prompts: PromptDefinition[];
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

export interface RunDetailResponse {
  run: RunRecord;
  events: ApmEvent[];
  stages: Array<{ name: string; status: string; prompts: string[] }>;
  tools: ApmEvent[];
  messages: Array<{ stage: string; prompt: string; role: string; content: string; createdAt: string }>;
  failure?: { message: string; stage?: string; prompt?: string };
}

export interface AttachSnapshot {
  run: RunRecord;
  logs: string;
  recentEvents: ApmEvent[];
  stagePrompts: Record<string, string[]>;
  promptHistoryByStage: Record<string, Array<{ prompt: string; output: string }>>;
  messageHistoryByStagePrompt: Record<
    string,
    Array<{ role: string; content: string; createdAt: string }>
  >;
}

export interface DesktopContext {
  apmHome: string;
  devMode: boolean;
  httpBaseUrl?: string;
  httpToken?: string;
}

export interface DaemonStatus {
  running: boolean;
  httpReachable: boolean;
  message: string;
}
