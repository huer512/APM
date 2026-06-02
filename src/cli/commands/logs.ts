import { formatEvents } from "../../logging/format-events.js";
import { readLogs, watchRun } from "../client.js";
import type { ApmEventKind } from "../../types/events.js";

export interface LogsCommandOptions {
  json?: boolean;
  follow?: boolean;
  kind?: string;
  fromSeq?: number;
}

export async function logsCommand(
  socketPath: string,
  runId: string,
  options: LogsCommandOptions = {},
): Promise<void> {
  const kind = options.kind as ApmEventKind | undefined;
  const fromSeq = options.fromSeq ?? 0;

  if (options.follow) {
    let cursor = fromSeq;
    while (true) {
      const snapshot = await watchRun(socketPath, runId, cursor);
      if (snapshot.events.length > 0) {
        const events = kind
          ? snapshot.events.filter((event) => event.kind === kind)
          : snapshot.events;
        if (events.length > 0) {
          if (options.json) {
            process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
          } else {
            process.stdout.write(`${formatEvents(events)}\n`);
          }
        }
        cursor = snapshot.nextSeq;
      }
      if (snapshot.done) {
        break;
      }
      await sleep(500);
    }
    return;
  }

  const result = await readLogs(socketPath, runId, { fromSeq, kind });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.events, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.text}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
