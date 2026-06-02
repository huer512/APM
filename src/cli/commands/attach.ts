import { attachBegin, attachEnd } from "../client.js";
import { startAttachTui } from "../../tui/attach-app.js";

export async function attachCommand(socketPath: string, runId: string): Promise<void> {
  await attachBegin(socketPath, runId);
  try {
    await startAttachTui(socketPath, runId);
  } finally {
    await attachEnd(socketPath, runId);
  }
}
