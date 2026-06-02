export const HELP_TEXT = `
APM Attach Commands:
  :help                               Show this help
  :stage <stage_name>                 Select stage
  :prompt <prompt_name>               Select prompt in selected stage
  :tools                              Toggle tool-only event view
  :next                               Continue to next stage
  :msg <prompt_name> <message>        Send message to prompt agent
  :quit                               Exit attach mode
`;

export type AttachAction =
  | { type: "help" }
  | { type: "stage"; stage: string }
  | { type: "prompt"; prompt: string }
  | { type: "tools" }
  | { type: "next" }
  | { type: "quit" }
  | { type: "msg"; prompt: string; message: string }
  | { type: "unknown"; input: string };

export function parseAttachInput(input: string): AttachAction {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: "unknown", input: "" };
  }
  if (trimmed === ":help") {
    return { type: "help" };
  }
  if (trimmed === ":next") {
    return { type: "next" };
  }
  if (trimmed === ":tools") {
    return { type: "tools" };
  }
  if (trimmed.startsWith(":stage ")) {
    const stage = trimmed.slice(7).trim();
    if (!stage) {
      return { type: "unknown", input: trimmed };
    }
    return { type: "stage", stage };
  }
  if (trimmed.startsWith(":prompt ")) {
    const prompt = trimmed.slice(8).trim();
    if (!prompt) {
      return { type: "unknown", input: trimmed };
    }
    return { type: "prompt", prompt };
  }
  if (trimmed === ":quit") {
    return { type: "quit" };
  }
  if (trimmed.startsWith(":msg ")) {
    const rest = trimmed.slice(5).trim();
    const [prompt, ...parts] = rest.split(" ");
    if (!prompt || parts.length === 0) {
      return { type: "unknown", input: trimmed };
    }
    return {
      type: "msg",
      prompt,
      message: parts.join(" "),
    };
  }
  return { type: "unknown", input: trimmed };
}
