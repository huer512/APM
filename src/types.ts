export type Dict<T = unknown> = Record<string, T>;

export interface PromptDefinition {
  name: string;
  path: string;
  model: string;
  metadata: Dict;
  body: string;
}

export interface StageDefinition {
  name: string;
  path: string;
  prompts: string[];
  nextStages: string[];
  rawBody: string;
}

export interface HostDefinition {
  name: string;
  path: string;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  virtualEnv?: string;
  workspace: string;
}

export interface EntryDefinition {
  name: string;
  path: string;
  entry: string;
  host: string;
  variables: Dict;
  description: string;
}

export interface PromptExecutionRecord {
  stage: string;
  prompt: string;
  output: string;
  startedAt: string;
  finishedAt: string;
}

export interface PromptMessageMeta {
  callId?: string;
  toolName?: string;
  status?: string;
}

export interface PromptMessageRecord {
  stage: string;
  prompt: string;
  role: "user" | "assistant" | "tool" | "thinking";
  content: string;
  createdAt: string;
  meta?: PromptMessageMeta;
}

export type RunStatus = "running" | "paused" | "finished" | "failed";

export interface RunRecord {
  id: string;
  entryName: string;
  hostName: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  currentStage?: string;
  currentPrompt?: string;
  activeBatch: string[];
  attachMode: boolean;
  waitingForNext: boolean;
  variables: Dict;
  promptHistory: PromptExecutionRecord[];
  messageHistory: PromptMessageRecord[];
  lastEventSeq?: number;
}

export interface RunRequest {
  entryName: string;
  params: Dict<string>;
}

export interface InterpolationHistory {
  byPrompt: Map<string, string[]>;
  byStagePrompt: Map<string, string[]>;
}

import type { ApmEvent } from "./types/events.js";

export interface AttachSnapshot {
  run: RunRecord;
  logs: string;
  recentEvents: ApmEvent[];
  stagePrompts: Record<string, string[]>;
  promptHistoryByStage: Record<string, PromptExecutionRecord[]>;
  messageHistoryByStagePrompt: Record<string, PromptMessageRecord[]>;
}
