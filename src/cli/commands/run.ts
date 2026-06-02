import { runEntry, watchRun } from "../client.js";
import { attachCommand } from "./attach.js";

export async function runCommand(
  socketPath: string,
  entryName: string,
  params: string[],
  detach: boolean,
  attach: boolean,
): Promise<void> {
  if (detach && attach) {
    throw new Error("--attach cannot be used together with --detach");
  }

  const payload = parseParams(params);
  const result = await runEntry(socketPath, entryName, payload, detach, attach);
  if (attach) {
    process.stderr.write(`Attached to run ${result.runId}\n`);
  } else {
    process.stdout.write(`${result.runId}\n`);
  }
  if (detach) {
    return;
  }
  if (attach) {
    await attachCommand(socketPath, result.runId);
    return;
  }

  let fromSeq = 0;
  while (true) {
    const snapshot = await watchRun(socketPath, result.runId, fromSeq);
    if (snapshot.chunk.length > 0) {
      process.stdout.write(`${snapshot.chunk}\n`);
    }
    fromSeq = snapshot.nextSeq;
    if (snapshot.done) {
      if (snapshot.run.status === "failed") {
        throw new Error(`Run ${snapshot.run.id} failed: ${snapshot.run.error ?? "unknown error"}`);
      }
      break;
    }
    await sleep(500);
  }
}

function parseParams(items: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const [key, ...rest] = item.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid --param format: ${item}`);
    }
    out[key] = rest.join("=");
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
