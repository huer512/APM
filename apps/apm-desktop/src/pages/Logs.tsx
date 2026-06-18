import { useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { ApmEvent } from "../lib/types";
import { EmptyState, PageHeader, formatDate } from "../components/UI";

export function Logs() {
  const { daemonStatus, config } = useApp();
  const [events, setEvents] = useState<ApmEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApmEvent | null>(null);

  const load = async () => {
    const result = await api.fetchEvents({ level, kind, query, limit: config?.logs?.defaultLimit ?? 200 });
    setEvents(result.events);
    setTotal(result.total);
    setSelected((current) => {
      if (!current) {
        return result.events[0] ?? null;
      }
      return result.events.some((event) => event.runId === current.runId && event.seq === current.seq)
        ? current
        : result.events[0] ?? null;
    });
  };

  useEffect(() => {
    if (daemonStatus?.httpReachable) {
      void load();
    }
  }, [daemonStatus?.httpReachable, level, kind, config?.logs?.defaultLimit]);

  const levelCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((acc, event) => {
      acc[event.level] = (acc[event.level] ?? 0) + 1;
      return acc;
    }, {});
  }, [events]);

  return (
    <div className="logs-page">
      <PageHeader
        title="日志与事件"
        description="按运行实例、事件类型和级别查看 Daemon 写入的真实事件。"
        actions={<button type="button" onClick={() => void load()}>刷新</button>}
      />
      <div className="logs-workspace">
        <div className="logs-fixed">
          <div className="toolbar surface-toolbar">
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">全部级别</option>
              <option value="debug">DEBUG</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">全部事件</option>
              <option value="run">run</option>
              <option value="entry">entry</option>
              <option value="stage">stage</option>
              <option value="prompt">prompt</option>
              <option value="message">message</option>
              <option value="tool">tool</option>
              <option value="thinking">thinking</option>
              <option value="hitl">hitl</option>
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索日志内容、run ID、Agent..." />
            <button type="button" onClick={() => void load()}>筛选</button>
          </div>
          <div className="log-metrics">
            <span>全部 {total}</span>
            <span>DEBUG {levelCounts.debug ?? 0}</span>
            <span>INFO {levelCounts.info ?? 0}</span>
            <span>WARN {levelCounts.warn ?? 0}</span>
            <span>ERROR {levelCounts.error ?? 0}</span>
            <span>保留 {config?.logs?.retentionDays ? `${config.logs.retentionDays} 天` : "不过滤"}</span>
          </div>
        </div>
        <div className="logs-content">
          <section className="panel logs-list-panel">
            <table className="table compact">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>运行实例</th>
                  <th>节点 / Agent</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={`${event.runId}-${event.seq}`}
                    className={selected?.runId === event.runId && selected?.seq === event.seq ? "selected-row" : ""}
                    onClick={() => setSelected(event)}
                  >
                    <td>{formatDate(event.ts)}</td>
                    <td><span className={`level ${event.level}`}>{event.level.toUpperCase()}</span></td>
                    <td>{event.runId}</td>
                    <td>{event.prompt ?? event.stage ?? "-"}</td>
                    <td>{summarizeEvent(event)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.length === 0 && <EmptyState title="暂无事件" description="运行工作流后，事件会显示在这里。" />}
          </section>
          <aside className="detail-panel logs-detail-panel">
            <h3>日志详情</h3>
            {selected ? (
              <>
                <dl className="detail-list">
                  <dt>级别</dt><dd>{selected.level}</dd>
                  <dt>时间</dt><dd>{formatDate(selected.ts)}</dd>
                  <dt>运行实例</dt><dd>{selected.runId}</dd>
                  <dt>类型</dt><dd>{selected.kind}</dd>
                  <dt>阶段</dt><dd>{selected.stage ?? "-"}</dd>
                  <dt>Agent</dt><dd>{selected.prompt ?? "-"}</dd>
                </dl>
                <pre className="json-box">{JSON.stringify(selected.data, null, 2)}</pre>
              </>
            ) : (
              <p className="muted">选择一条日志查看详情。</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function summarizeEvent(event: ApmEvent): string {
  const data = event.data ?? {};
  return String(data.detail ?? data.error ?? data.action ?? data.role ?? data.status ?? JSON.stringify(data)).slice(0, 160);
}
