import type { Dict } from "../types.js";

export interface ParsedMarkdown {
  frontmatter: Dict;
  body: string;
}

export function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

export function assertOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Field "${field}" must be a valid number when provided.`);
}

export function parseSectionList(body: string, title: string): string[] {
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

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
