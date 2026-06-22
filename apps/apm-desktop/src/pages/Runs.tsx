import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { RunRecord } from "../lib/types";
import { EmptyState, PageHeader, StatusBadge, formatDate, formatDuration } from "../components/UI";

const STATUS_OPTIONS = [
  ["", "全部"],
  ["running", "运行中"],
  ["paused", "等待人工"],
  ["finished", "成功"],
  ["failed", "失败"],
  ["stopped", "已停止"],
];

export function Runs() {
  const { daemonStatus } = useApp();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  const load = async () => {
    setRuns(await api.fetchRuns(true));
  };

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [daemonStatus?.httpReachable]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs
      .filter((run) => !status || run.status === status)
      .filter((run) => {
        if (!q) {
          return true;
        }
        return [run.id, run.entryName, run.currentStage, run.currentPrompt, run.hostName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
  }, [query, runs, status]);

  const counts = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [runs]);

  return (
    <div>
      <PageHeader
        title="实例列表"
        description="查看和管理所有工作流运行记录。"
        actions={
          <>
            <Link className="button primary" to="/new-run">新建运行</Link>
            <button type="button" onClick={() => void load()}>刷新</button>
          </>
        }
      />
      <div className="filter-tabs">
        {STATUS_OPTIONS.map(([value, label]) => (
          <button key={value} type="button" className={status === value ? "active" : ""} onClick={() => setStatus(value)}>
            {label} {value ? counts[value] ?? 0 : runs.length}
          </button>
        ))}
      </div>
      <div className="toolbar surface-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索运行 ID、工作流、Agent、阶段..." />
      </div>
      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>状态</th>
              <th>运行 ID</th>
              <th>工作流</th>
              <th>当前阶段</th>
              <th>当前 Agent</th>
              <th>主机</th>
              <th>开始时间</th>
              <th>耗时</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => (
              <tr key={run.id}>
                <td><StatusBadge status={run.status} /></td>
                <td>{run.id}</td>
                <td>{run.entryName}</td>
                <td>{run.currentStage ?? "-"}</td>
                <td>{run.currentPrompt ?? "-"}</td>
                <td>{run.hostName || "-"}</td>
                <td>{formatDate(run.startedAt ?? run.createdAt)}</td>
                <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                <td>
                  <Link to={`/runs/${run.id}`}>查看</Link>
                  {" · "}
                  <Link to={`/runs/${run.id}?tab=attach&autoAttach=1`}>接管</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState title="没有匹配的实例" description="调整筛选条件，或从工作流页面启动一次运行。" />}
      </section>
    </div>
  );
}
