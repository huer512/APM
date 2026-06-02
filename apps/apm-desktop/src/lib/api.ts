import type { ApmEvent, AttachSnapshot, Catalog, ConfigResponse, RunRecord } from "./types";

let baseUrl = "";
let token = "";

export function setApiCredentials(url: string, apiToken: string): void {
  baseUrl = url.replace(/\/$/, "");
  token = apiToken;
}

export function getApiCredentials(): { baseUrl: string; token: string } {
  return { baseUrl, token };
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<{ ok: boolean; version: string }> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; version: string }>;
}

export async function fetchRuns(all = false): Promise<RunRecord[]> {
  const data = await apiFetch<{ runs: RunRecord[] }>(`/runs?all=${all ? "true" : "false"}`);
  return data.runs;
}

export async function fetchRun(runId: string): Promise<RunRecord> {
  const data = await apiFetch<{ run: RunRecord }>(`/runs/${runId}`);
  return data.run;
}

export async function createRun(body: {
  entryName: string;
  params: Record<string, unknown>;
  detach?: boolean;
  attach?: boolean;
}): Promise<{ runId: string }> {
  return apiFetch("/runs", {
    method: "POST",
    body: JSON.stringify({
      entryName: body.entryName,
      params: body.params,
      detach: body.detach !== false,
      attach: body.attach === true,
    }),
  });
}

export async function fetchLogs(
  runId: string,
  fromSeq = 0,
  kind?: string,
): Promise<{ events: ApmEvent[]; text: string }> {
  const params = new URLSearchParams({ fromSeq: String(fromSeq) });
  if (kind) {
    params.set("kind", kind);
  }
  return apiFetch(`/runs/${runId}/logs?${params}`);
}

export function subscribeRunEvents(
  runId: string,
  fromSeq: number,
  onWatch: (payload: {
    run: RunRecord;
    events: ApmEvent[];
    chunk: string;
    done: boolean;
    nextSeq: number;
  }) => void,
  onError: (err: Error) => void,
): () => void {
  const params = new URLSearchParams({ fromSeq: String(fromSeq), token });
  const source = new EventSource(`${baseUrl}/runs/${runId}/events/stream?${params}`);
  source.addEventListener("watch", (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        run: RunRecord;
        events: ApmEvent[];
        chunk: string;
        done: boolean;
        nextSeq: number;
      };
      onWatch(data);
      if (data.done) {
        source.close();
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
  source.onerror = () => {
    onError(new Error("SSE connection error"));
    source.close();
  };
  return () => source.close();
}

export async function fetchCatalog(): Promise<Catalog> {
  return apiFetch("/catalog");
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return apiFetch("/config");
}

export async function updateConfig(patch: {
  cursorApiKey?: string;
  http?: { enabled?: boolean; host?: string; port?: number };
}): Promise<ConfigResponse> {
  return apiFetch("/config", { method: "PUT", body: JSON.stringify(patch) });
}

export async function attachBegin(runId: string): Promise<void> {
  await apiFetch(`/runs/${runId}/attach/begin`, { method: "POST" });
}

export async function attachEnd(runId: string): Promise<void> {
  await apiFetch(`/runs/${runId}/attach/end`, { method: "POST" });
}

export async function attachSnapshot(runId: string): Promise<AttachSnapshot> {
  return apiFetch(`/runs/${runId}/attach/snapshot`);
}

export async function attachNext(runId: string): Promise<void> {
  await apiFetch(`/runs/${runId}/attach/next`, { method: "POST" });
}

export async function attachMessage(
  runId: string,
  prompt: string,
  message: string,
): Promise<{ output: string }> {
  return apiFetch(`/runs/${runId}/attach/message`, {
    method: "POST",
    body: JSON.stringify({ prompt, message }),
  });
}
