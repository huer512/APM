import path from "node:path";
import { promises as fs } from "node:fs";
import yaml from "js-yaml";
import {
  type Dict,
  type EntryDefinition,
  type HostDefinition,
  type PromptDefinition,
  type StageDefinition,
} from "../types.js";
import { listMarkdownFiles, stemName } from "../utils/fs.js";
import { assertOptionalNumber, assertString, parseSectionList } from "./schemas.js";

interface Catalog {
  prompts: Map<string, string>;
  stages: Map<string, string>;
  hosts: Map<string, string>;
  entries: Map<string, string>;
}

export interface WorkflowBundle {
  rootDir: string;
  entry: EntryDefinition;
  host: HostDefinition;
  stages: Map<string, StageDefinition>;
  prompts: Map<string, PromptDefinition>;
}

export async function buildCatalog(rootDir: string): Promise<Catalog> {
  const [prompts, stages, hosts, entries] = await Promise.all([
    scanNamedMarkdown(path.join(rootDir, "prompts")),
    scanNamedMarkdown(path.join(rootDir, "stages")),
    scanNamedMarkdown(path.join(rootDir, "hosts")),
    scanNamedMarkdown(path.join(rootDir, "entries")),
  ]);

  return { prompts, stages, hosts, entries };
}

export async function loadWorkflowBundle(
  rootDir: string,
  entryName: string,
  options: { hostName?: string } = {},
): Promise<WorkflowBundle> {
  const catalog = await buildCatalog(rootDir);
  const entryPath = mustGet(catalog.entries, entryName, "entry");
  const entry = await loadEntry(entryName, entryPath);
  const selectedHost = options.hostName?.trim() || entry.host;
  const hostPath = mustGet(catalog.hosts, selectedHost, "host");
  const host = await loadHost(selectedHost, hostPath, rootDir);

  const stageQueue = [entry.entry];
  const stages = new Map<string, StageDefinition>();
  const prompts = new Map<string, PromptDefinition>();

  while (stageQueue.length > 0) {
    const stageName = stageQueue.shift() as string;
    if (stages.has(stageName)) {
      continue;
    }

    const stagePath = mustGet(catalog.stages, stageName, "stage");
    const stage = await loadStage(stageName, stagePath);
    stages.set(stageName, stage);
    stageQueue.push(...stage.nextStages);

    for (const promptName of stage.prompts) {
      if (prompts.has(promptName)) {
        continue;
      }
      const promptPath = mustGet(catalog.prompts, promptName, "prompt");
      const prompt = await loadPrompt(promptName, promptPath);
      prompts.set(promptName, prompt);
    }
  }

  detectCycles(stages, entry.entry);

  return {
    rootDir,
    entry,
    host,
    stages,
    prompts,
  };
}

async function scanNamedMarkdown(dir: string): Promise<Map<string, string>> {
  const files = await listMarkdownFiles(dir);
  const map = new Map<string, string>();
  for (const file of files) {
    const name = stemName(file);
    if (map.has(name)) {
      throw new Error(`Duplicate markdown name "${name}" under ${dir}.`);
    }
    map.set(name, file);
  }
  return map;
}

function mustGet(map: Map<string, string>, name: string, kind: string): string {
  const found = map.get(name);
  if (!found) {
    throw new Error(`Cannot find ${kind} "${name}" in configured directory.`);
  }
  return found;
}

function parseMarkdown(raw: string): { frontmatter: Dict; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const front = (yaml.load(match[1]) ?? {}) as Dict;
  return { frontmatter: front, body: match[2].trim() };
}

export async function loadPrompt(name: string, filePath: string): Promise<PromptDefinition> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const { frontmatter, body } = parseMarkdown(raw);
    const model = typeof frontmatter.model === "string" && frontmatter.model.trim().length > 0
      ? frontmatter.model.trim()
      : "auto";
    return {
      name,
      path: filePath,
      model,
      metadata: frontmatter,
      body,
    };
  } catch (error) {
    throw new Error(`Failed to load prompt "${name}" from ${filePath}: ${String(error)}`);
  }
}

export async function loadStage(name: string, filePath: string): Promise<StageDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  const { body } = parseMarkdown(raw);
  const prompts = parseSectionList(body, "提示词");
  const nextStages = parseSectionList(body, "后继阶段");
  if (prompts.length === 0) {
    throw new Error(`Stage "${name}" has no prompts in section "提示词".`);
  }
  return {
    name,
    path: filePath,
    prompts,
    nextStages,
    rawBody: body,
  };
}

export async function loadHost(name: string, filePath: string, rootDir: string): Promise<HostDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  const { frontmatter } = parseMarkdown(raw);
  const host = assertString(frontmatter.host ?? "localhost", `${name}.host`);
  const workspaceRaw = assertString(frontmatter.workspace ?? ".", `${name}.workspace`);
  const workspace = path.isAbsolute(workspaceRaw) ? workspaceRaw : path.join(rootDir, workspaceRaw);

  return {
    name,
    path: filePath,
    host,
    port: assertOptionalNumber(frontmatter.port, `${name}.port`),
    username: typeof frontmatter.username === "string" ? frontmatter.username : undefined,
    password: typeof frontmatter.password === "string" ? frontmatter.password : undefined,
    privateKey: typeof frontmatter.privateKey === "string" ? frontmatter.privateKey : undefined,
    virtualEnv: typeof frontmatter.virtualEnv === "string" ? frontmatter.virtualEnv : undefined,
    workspace,
  };
}

export async function loadEntry(name: string, filePath: string): Promise<EntryDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  const { frontmatter, body } = parseMarkdown(raw);
  const entry = assertString(frontmatter.entry, `${name}.entry`);
  const host = assertString(frontmatter.host, `${name}.host`);

  const variables: Dict = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key !== "entry" && key !== "host") {
      variables[key] = value;
    }
  }

  return {
    name,
    path: filePath,
    entry,
    host,
    variables,
    description: body,
  };
}

function detectCycles(stages: Map<string, StageDefinition>, root: string): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (stage: string): void => {
    if (visited.has(stage)) {
      return;
    }
    if (visiting.has(stage)) {
      throw new Error(`Detected cycle at stage "${stage}".`);
    }
    visiting.add(stage);
    const node = stages.get(stage);
    if (!node) {
      throw new Error(`Stage "${stage}" is missing.`);
    }
    for (const next of node.nextStages) {
      if (!stages.has(next)) {
        throw new Error(`Stage "${stage}" references missing next stage "${next}".`);
      }
      dfs(next);
    }
    visiting.delete(stage);
    visited.add(stage);
  };

  dfs(root);
}
