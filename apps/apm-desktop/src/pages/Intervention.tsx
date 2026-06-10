import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { RunRecord } from "../lib/types";
import { EmptyState, PageHeader, StatusBadge, formatDate } from "../components/UI";

export function Intervention() {
  const { daemonStatus } = useApp();
  const [runs, setRuns] = useState<RunRecord[]>([]);

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

  const items = useMemo(
    () => runs.filter((run) => run.attachMode || run.waitingForNext || run.status === "paused"),
    [runs],
  );

  return (
    <div>
      <PageHeader
        title="人工介入"
        description="查看等待确认或已进入 Attach 模式的运行实例。"
        actions={<button type="button" onClick={() => void load()}>刷新</button>}
      />
      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>运行 ID</th>
              <th>工作流</th>
              <th>状态</th>
              <th>当前阶段</th>
              <th>当前 Agent</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((run) => (
              <tr key={run.id}>
                <td>{run.id}</td>
                <td>{run.entryName}</td>
                <td><StatusBadge status={run.status} /></td>
                <td>{run.currentStage ?? "-"}</td>
                <td>{run.currentPrompt ?? "-"}</td>
                <td>{formatDate(run.updatedAt)}</td>
                <td><Link to={`/runs/${run.id}?tab=attach`}>进入 Attach</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <EmptyState title="暂无等待人工介入的运行" description="启动运行时选择 Attach，或工作流暂停后会出现在这里。" />}
      </section>
    </div>
  );
}
