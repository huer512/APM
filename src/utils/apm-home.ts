import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { ensureDir, pathExists } from "./fs.js";

export interface ApmHttpConfig {
  enabled?: boolean;
  host?: string;
  port?: number;
}

export interface ApmLogsConfig {
  retentionDays?: number;
  defaultLimit?: number;
}

export interface ApmConfigFile {
  cursorApiKey?: string;
  http?: ApmHttpConfig;
  logs?: ApmLogsConfig;
}

export function resolveApmHomeDir(): string {
  return process.env.APM_HOME?.trim() || path.join(os.homedir(), ".apm");
}

export function resolveApmSocketPath(apmHomeDir = resolveApmHomeDir()): string {
  return path.join(apmHomeDir, "apm.sock");
}

export function resolveApmHttpTokenPath(apmHomeDir = resolveApmHomeDir()): string {
  return path.join(apmHomeDir, "state", "http.token");
}

export function defaultHttpConfig(): Required<Pick<ApmHttpConfig, "host" | "port">> & { enabled: boolean } {
  return {
    enabled: true,
    host: "127.0.0.1",
    port: 19740,
  };
}

export async function ensureApmHomeInitialized(apmHomeDir = resolveApmHomeDir()): Promise<void> {
  await ensureDir(apmHomeDir);
  await ensureDir(path.join(apmHomeDir, "prompts"));
  await ensureDir(path.join(apmHomeDir, "stages"));
  await ensureDir(path.join(apmHomeDir, "hosts"));
  await ensureDir(path.join(apmHomeDir, "entries"));
  await ensureDir(path.join(apmHomeDir, "state"));

  const configPath = path.join(apmHomeDir, "config.json");
  if (!(await pathExists(configPath))) {
    const defaults = defaultHttpConfig();
    const template: ApmConfigFile = {
      cursorApiKey: "",
      http: {
        enabled: false,
        host: defaults.host,
        port: defaults.port,
      },
      logs: defaultLogsConfig(),
    };
    await fs.writeFile(configPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  }

  await ensureHttpToken(apmHomeDir);
}

export async function ensureHttpToken(apmHomeDir = resolveApmHomeDir()): Promise<string> {
  const tokenPath = resolveApmHttpTokenPath(apmHomeDir);
  if (await pathExists(tokenPath)) {
    const existing = (await fs.readFile(tokenPath, "utf8")).trim();
    if (existing.length > 0) {
      return existing;
    }
  }
  const token = randomBytes(24).toString("hex");
  await fs.writeFile(tokenPath, `${token}\n`, "utf8");
  return token;
}

export async function loadApmConfigRaw(apmHomeDir = resolveApmHomeDir()): Promise<ApmConfigFile> {
  const configPath = path.join(apmHomeDir, "config.json");
  if (!(await pathExists(configPath))) {
    return {};
  }
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw) as ApmConfigFile;
}

export async function loadApmConfig(apmHomeDir = resolveApmHomeDir()): Promise<ApmConfigFile> {
  const parsed = await loadApmConfigRaw(apmHomeDir);
  const cursorApiKey = typeof parsed.cursorApiKey === "string" ? parsed.cursorApiKey.trim() : "";
  const http = normalizeHttpConfig(parsed.http);
  const logs = normalizeLogsConfig(parsed.logs);
  return {
    cursorApiKey: cursorApiKey || undefined,
    http,
    logs,
  };
}

export async function saveApmConfig(apmHomeDir: string, patch: ApmConfigFile): Promise<ApmConfigFile> {
  const current = await loadApmConfigRaw(apmHomeDir);
  const merged: ApmConfigFile = {
    ...current,
    ...patch,
    http: patch.http !== undefined ? { ...current.http, ...patch.http } : current.http,
    logs: patch.logs !== undefined ? { ...current.logs, ...patch.logs } : current.logs,
  };
  const configPath = path.join(apmHomeDir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return loadApmConfig(apmHomeDir);
}

export function resolveHttpListen(apmHomeDir: string, config: ApmConfigFile): { host: string; port: number; enabled: boolean } {
  const defaults = defaultHttpConfig();
  const http = config.http ?? {};
  const enabled = http.enabled !== false;
  const host = typeof http.host === "string" && http.host.trim().length > 0 ? http.host.trim() : defaults.host;
  const port =
    typeof http.port === "number" && Number.isFinite(http.port) && http.port >= 0
      ? Math.floor(http.port)
      : defaults.port;
  return { host, port, enabled };
}

export function defaultLogsConfig(): Required<ApmLogsConfig> {
  return {
    retentionDays: 30,
    defaultLimit: 200,
  };
}

function normalizeHttpConfig(http: ApmHttpConfig | undefined): ApmHttpConfig | undefined {
  if (!http) {
    return undefined;
  }
  const defaults = defaultHttpConfig();
  return {
    enabled: http.enabled !== false,
    host: typeof http.host === "string" && http.host.trim().length > 0 ? http.host.trim() : defaults.host,
    port:
      typeof http.port === "number" && Number.isFinite(http.port) && http.port >= 0
        ? Math.floor(http.port)
        : defaults.port,
  };
}

function normalizeLogsConfig(logs: ApmLogsConfig | undefined): ApmLogsConfig {
  const defaults = defaultLogsConfig();
  return {
    retentionDays:
      typeof logs?.retentionDays === "number" && Number.isFinite(logs.retentionDays) && logs.retentionDays >= 0
        ? Math.floor(logs.retentionDays)
        : defaults.retentionDays,
    defaultLimit:
      typeof logs?.defaultLimit === "number" && Number.isFinite(logs.defaultLimit) && logs.defaultLimit > 0
        ? Math.floor(logs.defaultLimit)
        : defaults.defaultLimit,
  };
}
