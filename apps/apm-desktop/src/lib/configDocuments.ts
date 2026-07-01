import type { CatalogItem } from "./types";

export type ConfigKind = "entries" | "stages" | "prompts" | "hosts";

export interface EntryDoc {
  entry: string;
  host: string;
  variables: Array<{ key: string; value: string }>;
  description: string;
}

export interface StageDoc {
  prompts: string[];
  nextStages: string[];
}

export interface PromptDoc {
  model: string;
  skills: boolean;
  apmTools: string;
  apmOps: string[];
  metadata: Array<{ key: string; value: string }>;
  body: string;
}

export interface HostDoc {
  host: string;
  port: string;
  username: string;
  password: string;
  privateKey: string;
  virtualEnv: string;
  workspace: string;
}

export type ConfigData = EntryDoc | StageDoc | PromptDoc | HostDoc;

export interface ConfigDocument {
  kind: ConfigKind;
  item: CatalogItem;
  raw: string;
  data: ConfigData;
  errors: string[];
}

interface MarkdownParts {
  frontmatter: Record<string, string>;
  body: string;
  errors: string[];
}

export function parseConfigDocument(kind: ConfigKind, item: CatalogItem, raw: string): ConfigDocument {
  const parts = parseMarkdown(raw);
  if (kind === "entries") {
    const variables = Object.entries(parts.frontmatter)
      .filter(([key]) => key !== "entry" && key !== "host")
      .map(([key, value]) => ({ key, value }));
    return {
      kind,
      item,
      raw,
      errors: [
        ...parts.errors,
        ...required(parts.frontmatter.entry, "entry"),
        ...required(parts.frontmatter.host, "host"),
      ],
      data: {
        entry: parts.frontmatter.entry ?? "",
        host: parts.frontmatter.host ?? "",
        variables,
        description: parts.body,
      },
    };
  }

  if (kind === "stages") {
    const prompts = parseSectionList(parts.body, "提示词");
    const nextStages = parseSectionList(parts.body, "后继阶段");
    return {
      kind,
      item,
      raw,
      errors: [...parts.errors, ...(prompts.length === 0 ? ["阶段必须至少包含一个 Prompt"] : [])],
      data: {
        prompts,
        nextStages,
      },
    };
  }

  if (kind === "hosts") {
    return {
      kind,
      item,
      raw,
      errors: [
        ...parts.errors,
        ...required(parts.frontmatter.host ?? "localhost", "host"),
        ...required(parts.frontmatter.workspace ?? ".", "workspace"),
      ],
      data: {
        host: parts.frontmatter.host ?? "localhost",
        port: parts.frontmatter.port ?? "",
        username: parts.frontmatter.username ?? "",
        password: parts.frontmatter.password ?? "",
        privateKey: parts.frontmatter.privateKey ?? "",
        virtualEnv: parts.frontmatter.virtualEnv ?? "",
        workspace: parts.frontmatter.workspace ?? ".",
      },
    };
  }

  const metadata = Object.entries(parts.frontmatter)
    .filter(([key]) => key !== "model" && key !== "skills" && key !== "apmTools" && key !== "apmOps")
    .map(([key, value]) => ({ key, value }));
  return {
    kind,
    item,
    raw,
    errors: parts.errors,
    data: {
      model: parts.frontmatter.model ?? "auto",
      skills: isTruthy(parts.frontmatter.skills),
      apmTools: parts.frontmatter.apmTools ?? "off",
      apmOps: parseCsv(parts.frontmatter.apmOps),
      metadata,
      body: parts.body,
    },
  };
}

export function serializeConfigDocument(doc: ConfigDocument): string {
  if (doc.kind === "entries") {
    const data = doc.data as EntryDoc;
    return withFrontmatter(
      {
        entry: data.entry,
        host: data.host,
        ...pairsToObject(data.variables),
      },
      data.description,
    );
  }

  if (doc.kind === "stages") {
    const data = doc.data as StageDoc;
    const body = [
      "## 提示词",
      ...data.prompts.filter(Boolean).map((item) => `- ${item}`),
      "",
      "## 后继阶段",
      ...data.nextStages.filter(Boolean).map((item) => `- ${item}`),
    ]
      .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
      .join("\n")
      .trim();
    return `${body}\n`;
  }

  if (doc.kind === "hosts") {
    const data = doc.data as HostDoc;
    return withFrontmatter(
      cleanObject({
        host: data.host,
        port: data.port,
        username: data.username,
        password: data.password,
        privateKey: data.privateKey,
        virtualEnv: data.virtualEnv,
        workspace: data.workspace,
      }),
      "",
    );
  }

  const data = doc.data as PromptDoc;
  return withFrontmatter(
    {
      model: data.model || "auto",
      skills: data.skills ? "true" : "",
      apmTools: data.apmTools && data.apmTools !== "off" ? data.apmTools : "",
      apmOps: data.apmOps.filter(Boolean).join(","),
      ...pairsToObject(data.metadata),
    },
    data.body,
  );
}

export function updateConfigData<T extends ConfigData>(doc: ConfigDocument, data: T): ConfigDocument {
  const next = { ...doc, data };
  const raw = serializeConfigDocument(next);
  return parseConfigDocument(doc.kind, doc.item, raw);
}

function parseMarkdown(raw: string): MarkdownParts {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized.trim(), errors: [] };
  }
  const frontmatter: Record<string, string> = {};
  const errors: string[] = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf(":");
    if (index < 0) {
      errors.push(`frontmatter 行格式无效: ${trimmed}`);
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    frontmatter[key] = unquote(value);
  }
  return { frontmatter, body: match[2].trim(), errors };
}

function withFrontmatter(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(cleanObject(frontmatter)).map(([key, value]) => `${key}: ${formatYamlValue(value)}`);
  const content = body.trim();
  return `---\n${lines.join("\n")}\n---${content ? `\n${content}` : ""}\n`;
}

function cleanObject(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => String(value ?? "").trim().length > 0));
}

function pairsToObject(pairs: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(
    pairs
      .map((pair) => [pair.key.trim(), pair.value.trim()] as const)
      .filter(([key]) => key.length > 0),
  );
}

function parseSectionList(body: string, title: string): string[] {
  const pattern = new RegExp(`##\\s*${escapeRegex(title)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const match = body.match(pattern);
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, "").trim())
    .filter(Boolean);
}

function required(value: string | undefined, field: string): string[] {
  return value?.trim() ? [] : [`缺少必填字段: ${field}`];
}

function isTruthy(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "1";
}

function parseCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatYamlValue(value: string): string {
  const raw = String(value ?? "");
  if (/^[A-Za-z0-9_./:${}\-]+$/.test(raw)) {
    return raw;
  }
  return JSON.stringify(raw);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
