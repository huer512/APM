import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { RunDetailResponse } from "../lib/types";
import { AttachPanel } from "./AttachPanel";
import { PageHeader, StatusBadge, formatDate, formatDuration } from "../components/UI";
import { MarkdownContent } from "../components/MarkdownContent";
import { buildDisplayMessages } from "../lib/messageDisplay";

export function RunDetail() {
  const { runId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = searchParams.get("tab") === "attach" ? "attach" : "overview";
  const { daemonStatus } = useApp();
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);

  const load = async () => {
    if (!runId) {
      return;
    }
    setDetail(await api.fetchRunDetail(runId));
  };

  useEffect(() => {
    if (!daemonStatus?.httpReachable || !runId) {
      return;
    }
    void load();
    let unsubscribe: (() => void) | undefined;
    unsubscribe = api.subscribeRunEvents(
      runId,
      detail?.events.length ? Math.max(...detail.events.map((event) => event.seq)) : 0,
      () => void load(),
      () => undefined,
    );
    const timer = setInterval(() => void load(), 3000);
    return () => {
      unsubscribe?.();
      clearInterval(timer);
    };
  }, [daemonStatus?.httpReachable, runId]);

  const run = detail?.run;
  const latestMessages = useMemo(() => buildDisplayMessages(detail?.messages ?? []).slice(-12), [detail?.messages]);

  const stop = async () => {
    if (!runId) {
      return;
    }
    await api.stopRun(runId);
    await load();
  };

  const retry = async () => {
    if (!runId) {
      return;
    }
    const result = await api.retryRun(runId);
    navigate(`/runs/${result.runId}`);
  };

  return (
    <div>
      <p className="breadcrumb"><Link to="/runs">实例列表</Link> / {runId}</p>
      <PageHeader
        title={runId}
        actions={
          <>
            {run && <StatusBadge status={run.status} />}
            {(run?.status === "running" || run?.status === "paused") && <button type="button" onClick={() => void stop()}>停止运行</button>}
            {run && (run.status === "failed" || run.status === "finished" || run.status === "stopped") && <button type="button" className="primary" onClick={() => void retry()}>重新运行</button>}
            <button type="button" onClick={() => setSearchParams({ tab: "attach" })}>接管运行</button>
          </>
        }
      />
      {run && (
        <div className="run-meta-bar">
          <span>工作流 <strong>{run.entryName}</strong></span>
          <span>开始时间 <strong>{formatDate(run.startedAt ?? run.createdAt)}</strong></span>
          <span>运行时长 <strong>{formatDuration(run.startedAt, run.finishedAt)}</strong></span>
          <span>主机 <strong>{run.hostName || "-"}</strong></span>
          <span>执行阶段 <strong>{run.currentStage ?? "-"}</strong></span>
        </div>
      )}
      <div className="tabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setSearchParams({})}>运行详情</button>
        <button type="button" className={tab === "attach" ? "active" : ""} onClick={() => setSearchParams({ tab: "attach" })}>接管</button>
      </div>

      {tab === "attach" && <AttachPanel runId={runId} />}
      {tab === "overview" && detail && (
        <>
          {detail.failure && (
            <section className="panel failure-panel">
              <h2>运行失败</h2>
              <p>{detail.failure.message}</p>
              <dl className="detail-list horizontal">
                <dt>失败阶段</dt><dd>{detail.failure.stage ?? "-"}</dd>
                <dt>失败 Agent</dt><dd>{detail.failure.prompt ?? "-"}</dd>
              </dl>
            </section>
          )}
          <div className="run-detail-grid">
            <section className="panel">
              <h2>阶段与 Agent</h2>
              <div className="stage-list">
                {detail.stages.map((stage) => (
                  <div key={stage.name} className={run?.currentStage === stage.name ? "active" : ""}>
                    <strong>{stage.name}</strong>
                    <span>{stage.status}</span>
                    <small>{stage.prompts.join(", ") || "暂无 Agent"}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2>消息</h2>
              <div className="message-list">
                {latestMessages.map((item, index) => (
                  item.type === "tool-group" ? (
                    <article key={item.id} className="tool-group">
                      <header>
                        <strong>{item.prompt ?? "tool"}</strong>
                        <span>工具调用 · 合并 {item.items.length} · {formatDate(item.createdAt)}</span>
                      </header>
                      <p>{item.items.map((message) => message.content).join("\n")}</p>
                    </article>
                  ) : (
                    <article key={`${item.createdAt}-${index}`} className={item.role}>
                      <header>
                        <strong>{item.prompt ?? "-"}</strong>
                        <span>{item.role} · {formatDate(item.createdAt)}{item.count > 1 ? ` · 合并 ${item.count}` : ""}</span>
                      </header>
                      <MarkdownContent content={item.content} className="message-markdown" />
                    </article>
                  )
                ))}
              </div>
            </section>
            <aside className="side-stack">
              <section className="panel">
                <h2>工具调用 ({detail.tools.length})</h2>
                <div className="event-list">
                  {detail.tools.slice(-8).map((event) => (
                    <div key={event.seq}>
                      <strong>{String(event.data.name ?? event.kind)}</strong>
                      <span>{String(event.data.status ?? event.level)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <h2>实时日志</h2>
                <div className="log-view">
                  {detail.events.slice(-30).map((event) => (
                    <div key={event.seq}>#{event.seq} [{event.level}] {event.kind} {event.stage ?? ""} {event.prompt ?? ""} {String(event.data.action ?? event.data.detail ?? event.data.error ?? "")}</div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
