export type MessageLike = {
  role: string;
  content: string;
  createdAt: string;
  stage?: string;
  prompt?: string;
};

export type TextDisplayMessage = MessageLike & { type: "message"; count: number };
export type ToolDisplayGroup = {
  type: "tool-group";
  id: string;
  createdAt: string;
  items: MessageLike[];
  stage?: string;
  prompt?: string;
};
export type DisplayMessage = TextDisplayMessage | ToolDisplayGroup;

export function buildDisplayMessages(messages: MessageLike[]): DisplayMessage[] {
  const display: DisplayMessage[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) {
      continue;
    }
    const role = normalizeMessageRole(message.role);
    const normalizedMessage = { ...message, role, content };
    const last = display[display.length - 1];
    if (role === "tool") {
      if (last?.type === "tool-group" && sameMessageThread(last, normalizedMessage)) {
        last.items.push(normalizedMessage);
        last.createdAt = message.createdAt;
      } else {
        display.push({
          type: "tool-group",
          id: `tool-${display.length}-${message.createdAt}`,
          createdAt: message.createdAt,
          items: [normalizedMessage],
          stage: normalizedMessage.stage,
          prompt: normalizedMessage.prompt,
        });
      }
      continue;
    }
    if (last?.type === "message" && last.role === role && sameMessageThread(last, normalizedMessage)) {
      last.content = mergeStreamingText(last.content, content, role);
      last.createdAt = message.createdAt;
      last.count += 1;
      continue;
    }
    display.push({ ...normalizedMessage, type: "message", count: 1 });
  }
  return display;
}

function normalizeMessageRole(role: string): string {
  const value = role.toLowerCase();
  if (value.includes("tool")) {
    return "tool";
  }
  if (value.includes("think") || value.includes("reason")) {
    return "thinking";
  }
  if (value.includes("assistant") || value.includes("model")) {
    return "assistant";
  }
  if (value.includes("user")) {
    return "user";
  }
  return value || "message";
}

function sameMessageThread(left: MessageLike, right: MessageLike): boolean {
  return (left.stage ?? "") === (right.stage ?? "") && (left.prompt ?? "") === (right.prompt ?? "");
}

function mergeStreamingText(left: string, right: string, role: string): string {
  const current = normalizeMergedText(left, role);
  const next = normalizeMergedText(right, role);
  if (!current) {
    return next;
  }
  if (!next || current.endsWith(next)) {
    return current;
  }
  if (next.startsWith(current)) {
    return next;
  }
  const overlap = findOverlap(current, next);
  if (overlap > 0) {
    return `${current}${next.slice(overlap)}`;
  }
  return role === "thinking" ? `${current}${next}` : `${current}\n\n${next}`;
}

function normalizeMergedText(value: string, role: string): string {
  const trimmed = value.trim();
  if (role !== "thinking") {
    return trimmed;
  }
  return trimmed.replace(/\s*[\r\n]+\s*/g, "");
}

function findOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size >= 8; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return size;
    }
  }
  return 0;
}
