import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { importMinimalTemplate, openApmHome } from "../lib/desktop";
import { useApp } from "../context/AppContext";
import type { Catalog, RunRecord } from "../lib/types";

export function Dashboard() {
  const { daemonStatus, config, context, startDaemon } = useApp();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [entryName, setEntryName] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void (async () => {
      const [runList, cat] = await Promise.all([api.fetchRuns(true), api.fetchCatalog()]);
      setRuns(runList.slice(0, 8));
      setCatalog(cat);
      if (cat.entries.length > 0 && !entryName) {
        setEntryName(cat.entries[0].name);
      }
    })();
  }, [daemonStatus?.httpReachable, entryName]);

  const handleRun = async () => {
    if (!entryName) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const params: Record<string, unknown> = {};
      if (task.trim()) {
        params.task = task.trim();
      }
      const { runId } = await api.createRun({ entryName, params, detach: true });
      setMessage(`已启动 run: ${runId}`);
      setRuns(await api.fetchRuns(true));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">仪表盘</h1>

      <div className="card">
        <h3>Daemon</h3>
        <p>{daemonStatus?.message}</p>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          APM_HOME: {context?.apmHome ?? config?.apmHome ?? "-"}
        </p>
        {!daemonStatus?.httpReachable && (
          <button type="button" className="primary" onClick={() => void startDaemon()}>
            启动 Daemon
          </button>
        )}
      </div>

      <div className="card">
        <h3>快速运行</h3>
        <div className="toolbar">
          <select value={entryName} onChange={(e) => setEntryName(e.target.value)}>
            <option value="">选择 entry</option>
            {(catalog?.entries ?? []).map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
          <input
            placeholder="task 参数（可选）"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button type="button" className="primary" disabled={busy || !entryName} onClick={() => void handleRun()}>
            后台运行
          </button>
        </div>
        {message && <p>{message}</p>}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>最近运行</h3>
          <Link to="/runs">查看全部</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Entry</th>
              <th>状态</th>
              <th>阶段</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.id}</Link>
                </td>
                <td>{run.entryName}</td>
                <td>
                  <span className={`badge ${run.status}`}>{run.status}</span>
                </td>
                <td>{run.currentStage ?? "-"}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--text-muted)" }}>
                  暂无运行记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="toolbar">
        <button type="button" onClick={() => void openApmHome()}>
          打开配置目录
        </button>
        <button
          type="button"
          onClick={() =>
            void importMinimalTemplate().then((msg) => {
              setMessage(msg);
            })
          }
        >
          导入 minimal 模板
        </button>
      </div>
    </div>
  );
}
