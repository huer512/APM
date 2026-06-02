import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { ApmEvent, RunRecord } from "../lib/types";
import { AttachPanel } from "./AttachPanel";

export function RunDetail() {
  const { runId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "attach" ? "attach" : "logs";
  const { daemonStatus } = useApp();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<ApmEvent[]>([]);
  const [logText, setLogText] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  useEffect(() => {
    if (!daemonStatus?.httpReachable || !runId) {
      return;
    }
    void api.fetchRun(runId).then(setRun);
  }, [daemonStatus?.httpReachable, runId]);

  useEffect(() => {
    if (!daemonStatus?.httpReachable || !runId || tab !== "logs") {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const result = await api.fetchLogs(runId, 0, kindFilter || undefined);
      if (cancelled) {
        return;
      }
      setEvents(result.events);
      setLogText(result.text);
      const last = result.events[result.events.length - 1];
      let seq = last ? last.seq + 1 : 0;

      unsubscribe = api.subscribeRunEvents(
        runId,
        seq,
        (payload) => {
          setRun(payload.run);
          if (payload.events.length > 0) {
            setEvents((prev) => {
              const merged = [...prev, ...payload.events];
              return kindFilter ? merged.filter((e) => e.kind === kindFilter) : merged;
            });
            if (payload.chunk) {
              setLogText((prev) => prev + payload.chunk);
            }
          }
          seq = payload.nextSeq;
        },
        () => undefined,
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [daemonStatus?.httpReachable, runId, tab, kindFilter]);

  if (!runId) {
    return <p>缺少 run ID</p>;
  }

  return (
    <div>
      <p>
        <Link to="/runs">← 返回列表</Link>
      </p>
      <h1 className="page-title">Run {runId}</h1>
      {run && (
        <div className="card">
          <p>
            Entry: {run.entryName} · 状态: <span className={`badge ${run.status}`}>{run.status}</span>
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Host: {run.hostName || "-"} · Stage: {run.currentStage ?? "-"} · Prompt: {run.currentPrompt ?? "-"}
          </p>
          {run.error && <p style={{ color: "var(--danger)" }}>{run.error}</p>}
        </div>
      )}

      <div className="tabs">
        <button
          type="button"
          className={tab === "logs" ? "active" : ""}
          onClick={() => setSearchParams({})}
        >
          日志
        </button>
        <button
          type="button"
          className={tab === "attach" ? "active" : ""}
          onClick={() => setSearchParams({ tab: "attach" })}
        >
          Attach / HITL
        </button>
      </div>

      {tab === "logs" && (
        <>
          <div className="toolbar">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">全部事件</option>
              <option value="run">run</option>
              <option value="stage">stage</option>
              <option value="tool">tool</option>
              <option value="prompt">prompt</option>
            </select>
          </div>
          <div className="card">
            <h4>结构化事件 ({events.length})</h4>
            <div className="log-view" style={{ maxHeight: 200 }}>
              {events.slice(-40).map((ev) => (
                <details key={ev.seq} style={{ marginBottom: 4 }}>
                  <summary>
                    #{ev.seq} [{ev.kind}] {ev.level}
                  </summary>
                  <pre style={{ margin: 4, whiteSpace: "pre-wrap" }}>{JSON.stringify(ev.data, null, 2)}</pre>
                </details>
              ))}
            </div>
          </div>
          <div className="card">
            <h4>日志流</h4>
            <div className="log-view">{logText || "等待事件…"}</div>
          </div>
        </>
      )}

      {tab === "attach" && <AttachPanel runId={runId} />}
    </div>
  );
}
