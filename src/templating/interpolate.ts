import type { Dict, InterpolationHistory } from "../types.js";

const TOKEN_REGEX = /\{([^{}]+)\}/g;

export interface InterpolationContext {
  variables: Dict;
  history: InterpolationHistory;
  source?: string;
}

export function createEmptyHistory(): InterpolationHistory {
  return {
    byPrompt: new Map<string, string[]>(),
    byStagePrompt: new Map<string, string[]>(),
  };
}

export function pushHistory(history: InterpolationHistory, stage: string, prompt: string, output: string): void {
  const byPrompt = history.byPrompt.get(prompt) ?? [];
  byPrompt.push(output);
  history.byPrompt.set(prompt, byPrompt);

  const stageKey = `${stage}.${prompt}`;
  const byStagePrompt = history.byStagePrompt.get(stageKey) ?? [];
  byStagePrompt.push(output);
  history.byStagePrompt.set(stageKey, byStagePrompt);
}

export function interpolateText(input: string, context: InterpolationContext): string {
  return input.replace(TOKEN_REGEX, (_, rawExpr: string) => {
    const expr = rawExpr.trim();
    const fromVar = context.variables[expr];
    if (fromVar !== undefined) {
      return stringifyValue(fromVar);
    }
    return resolveHistoryRef(expr, context.history, context.source);
  });
}

function resolveHistoryRef(expr: string, history: InterpolationHistory, source?: string): string {
  const parsed = parseReference(expr);
  if (!parsed) {
    throw new Error(withSource(`Invalid interpolation token: {${expr}}`, source));
  }

  const sourceKey = parsed.stage ? `${parsed.stage}.${parsed.prompt}` : parsed.prompt;
  const entries = parsed.stage
    ? history.byStagePrompt.get(sourceKey)
    : history.byPrompt.get(sourceKey);

  if (!entries || entries.length === 0) {
    throw new Error(withSource(`No history found for token {${expr}}.`, source));
  }

  const index = parsed.index === undefined ? -1 : parsed.index;
  const normalized = index < 0 ? entries.length + index : index;
  if (normalized < 0 || normalized >= entries.length) {
    throw new Error(withSource(`History index out of range for token {${expr}}.`, source));
  }

  return entries[normalized] ?? "";
}

function withSource(message: string, source?: string): string {
  if (!source) {
    return message;
  }
  return `${message} (source: ${source})`;
}

function parseReference(expr: string): { stage?: string; prompt: string; index?: number } | null {
  const match = expr.match(/^([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?(?:\[(-?\d+)\])?$/);
  if (!match) {
    return null;
  }
  const first = match[1];
  const second = match[2];
  const indexRaw = match[3];
  const index = indexRaw !== undefined ? Number(indexRaw) : undefined;

  if (second) {
    return { stage: first, prompt: second, index };
  }
  return { prompt: first, index };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
