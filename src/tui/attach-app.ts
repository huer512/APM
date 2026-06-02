import readline from "node:readline";
import { formatEvent } from "../logging/format-events.js";
import { attachMessage, attachNext, attachSnapshot } from "../cli/client.js";
import type { ApmEvent } from "../types/events.js";
import { HELP_TEXT, parseAttachInput } from "./keymap.js";

export async function startAttachTui(socketPath: string, runId: string): Promise<void> {
  let closing = false;
  let selectedStage = "";
  let selectedPrompt = "";
  let toolOnlyView = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: "apm> ",
  });

  const draw = async (): Promise<void> => {
    const snapshot = await attachSnapshot(socketPath, runId);
    const stageNames = Object.keys(snapshot.stagePrompts).sort();
    if (!selectedStage || !stageNames.includes(selectedStage)) {
      selectedStage = stageNames[0] ?? snapshot.run.currentStage ?? "";
    }
    const promptsInStage = snapshot.stagePrompts[selectedStage] ?? [];
    if (!selectedPrompt || !promptsInStage.includes(selectedPrompt)) {
      selectedPrompt = snapshot.run.currentPrompt ?? promptsInStage[0] ?? "";
    }
    const promptKey = selectedStage && selectedPrompt ? `${selectedStage}.${selectedPrompt}` : "";
    const messages = promptKey ? (snapshot.messageHistoryByStagePrompt[promptKey] ?? []) : [];
    const recentMessages = messages.slice(-10);
    const recentPromptHistory = selectedStage
      ? (snapshot.promptHistoryByStage[selectedStage] ?? []).slice(-10)
      : [];
    const toolEvents = (snapshot.recentEvents ?? [])
      .filter((event) => event.kind === "tool")
      .slice(-15);
    const recentLogs = toolOnlyView
      ? (snapshot.recentEvents ?? []).filter((event) => event.kind === "tool")
      : (snapshot.recentEvents ?? []).slice(-20);

    clearScreen();
    process.stdout.write(`APM Attach: ${runId}\n`);
    process.stdout.write(`Status: ${snapshot.run.status}\n`);
    process.stdout.write(`Current Stage: ${snapshot.run.currentStage ?? "-"}\n`);
    process.stdout.write(`Current Prompt: ${snapshot.run.currentPrompt ?? "-"}\n`);
    process.stdout.write(`Active Batch: ${(snapshot.run.activeBatch ?? []).join(", ") || "-"}\n`);
    process.stdout.write(`Waiting For Next: ${snapshot.run.waitingForNext ? "yes" : "no"}\n`);
    process.stdout.write(`Selected Stage: ${selectedStage || "-"}\n`);
    process.stdout.write(`Selected Prompt: ${selectedPrompt || "-"}\n`);
    process.stdout.write(`Tool-only View: ${toolOnlyView ? "yes" : "no"}\n`);

    process.stdout.write("\nStages:\n");
    for (const stage of stageNames) {
      const mark = stage === selectedStage ? "*" : " ";
      process.stdout.write(` ${mark} ${stage}\n`);
    }

    process.stdout.write("\nPrompts:\n");
    for (const prompt of promptsInStage) {
      const mark = prompt === selectedPrompt ? "*" : " ";
      process.stdout.write(` ${mark} ${prompt}\n`);
    }

    process.stdout.write("\nPrompt Messages (latest 10):\n");
    if (recentMessages.length === 0) {
      process.stdout.write(" (none)\n");
    } else {
      for (const msg of recentMessages) {
        process.stdout.write(` [${msg.role}] ${msg.content}\n`);
      }
    }

    process.stdout.write("\nTool Events (latest 15):\n");
    if (toolEvents.length === 0) {
      process.stdout.write(" (none)\n");
    } else {
      for (const event of toolEvents) {
        process.stdout.write(` ${formatToolLine(event)}\n`);
      }
    }

    process.stdout.write("\nStage Prompt Outputs (latest 10):\n");
    if (recentPromptHistory.length === 0) {
      process.stdout.write(" (none)\n");
    } else {
      for (const item of recentPromptHistory) {
        process.stdout.write(` ${item.prompt}: ${item.output}\n`);
      }
    }

    process.stdout.write("\nRecent Events:\n");
    if (recentLogs.length === 0) {
      process.stdout.write(" (none)\n");
    } else {
      for (const event of recentLogs) {
        process.stdout.write(` ${formatEvent(event)}\n`);
      }
    }

    process.stdout.write("\n");
    rl.prompt();
  };

  const timer = setInterval(() => {
    if (closing) {
      return;
    }
    void draw().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
    });
  }, 1000);

  rl.on("line", async (line) => {
    const action = parseAttachInput(line);
    try {
      if (action.type === "help") {
        process.stdout.write(`${HELP_TEXT}\n`);
      } else if (action.type === "stage") {
        selectedStage = action.stage;
      } else if (action.type === "prompt") {
        selectedPrompt = action.prompt;
      } else if (action.type === "tools") {
        toolOnlyView = !toolOnlyView;
      } else if (action.type === "next") {
        await attachNext(socketPath, runId);
      } else if (action.type === "msg") {
        const result = await attachMessage(socketPath, runId, action.prompt, action.message);
        process.stdout.write(`\n[agent:${action.prompt}] ${result.output}\n`);
      } else if (action.type === "quit") {
        closing = true;
        clearInterval(timer);
        rl.close();
        return;
      } else {
        process.stdout.write("Unknown command. Use :help\n");
      }
      await draw();
    } catch (error) {
      process.stderr.write(`Command failed: ${String(error)}\n`);
      rl.prompt();
    }
  });

  rl.on("close", () => {
    closing = true;
    clearInterval(timer);
  });

  process.stdout.write(`${HELP_TEXT}\n`);
  await draw();
}

function formatToolLine(event: ApmEvent): string {
  return formatEvent(event);
}

function clearScreen(): void {
  process.stdout.write("\x1Bc");
}
