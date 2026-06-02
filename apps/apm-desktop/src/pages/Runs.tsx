import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { Catalog, RunRecord } from "../lib/types";

export function Runs() {
  const { daemonStatus } = useApp();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [all, setAll] = useState(true);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [paramsText, setParamsText] = useState("task=");
  const [attachMode, setAttachMode] = useState(false);

  const load = async () => {
    const [list, cat] = await Promise.all([api.fetchRuns(all), api.fetchCatalog()]);
    setRuns(list);
    setCatalog(cat);
  };

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [daemonStatus?.httpReachable, all]);

  const parseParams = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const line of paramsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...rest] = trimmed.split("=");
      out[key.trim()] = rest.join("=").trim();
    }
    return out;
  };

  const handleCreate = async () => {
    const { runId } = await api.createRun({
      entryName,
      params: parseParams(),
      detach: !attachMode,
      attach: attachMode,
    });
    setShowNew(false);
    await load();
    if (attachMode) {
      window.location.href = `/runs/${runId}?tab=attach`;
    }
  };

  return (
    <div>
      <h1 className="page-title">运行实例</h1>
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 显示全部
        </label>
        <button type="button" className="primary" onClick={() => setShowNew(true)}>
          新建运行
        </button>
        <button type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {showNew && (
        <div className="card">
          <h3>新建运行</h3>
          <div className="form-row">
            <label>Entry</label>
            <select value={entryName} onChange={(e) => setEntryName(e.target.value)}>
              <option value="">选择</option>
              {(catalog?.entries ?? []).map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>参数（每行 key=value）</label>
            <textarea rows={4} value={paramsText} onChange={(e) => setParamsText(e.target.value)} />
          </div>
          <label>
            <input type="checkbox" checked={attachMode} onChange={(e) => setAttachMode(e.target.checked)} />
            启动后立即 Attach（HITL）
          </label>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={!entryName} onClick={() => void handleCreate()}>
              启动
            </button>
            <button type="button" onClick={() => setShowNew(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Entry</th>
              <th>状态</th>
              <th>Host</th>
              <th>当前阶段</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <code>{run.id}</code>
                </td>
                <td>{run.entryName}</td>
                <td>
                  <span className={`badge ${run.status}`}>{run.status}</span>
                </td>
                <td>{run.hostName || "-"}</td>
                <td>{run.currentStage ?? "-"}</td>
                <td>
                  <Link to={`/runs/${run.id}`}>详情</Link>
                  {" · "}
                  <Link to={`/runs/${run.id}?tab=attach`}>Attach</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
