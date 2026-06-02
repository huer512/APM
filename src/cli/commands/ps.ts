import { listRuns } from "../client.js";

export async function psCommand(socketPath: string, all: boolean): Promise<void> {
  const rows = await listRuns(socketPath, all);
  if (rows.length === 0) {
    process.stdout.write("No runs found.\n");
    return;
  }
  process.stdout.write("RUN ID         STATUS    ENTRY       STAGE         PROMPT       UPDATED\n");
  for (const row of rows) {
    const cols = [
      pad(row.id, 14),
      pad(row.status, 9),
      pad(row.entryName, 11),
      pad(row.currentStage ?? "-", 13),
      pad(row.currentPrompt ?? "-", 12),
      row.updatedAt,
    ];
    process.stdout.write(`${cols.join(" ")}\n`);
  }
}

function pad(input: string, width: number): string {
  const sliced = input.length > width ? input.slice(0, width) : input;
  return sliced.padEnd(width, " ");
}
