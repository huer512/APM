export interface RunRecord {
  id: string;
  entryName: string;
  hostName: string;
  status: "running" | "paused" | "finished" | "failed";
  createdAt: string;
  updatedAt: string;
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
  apmHome: string;
  httpBaseUrl?: string;
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
