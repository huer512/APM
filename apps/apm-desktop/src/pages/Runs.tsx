import { useEffect, useMemo, useRef, useState } from "react";
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
  const [busyRunId, setBusyRunId] = useState("");
  const [openMenuRunId, setOpenMenuRunId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");

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

  const runAction = async (runId: string, action: () => Promise<unknown>) => {
    setError("");
    setBusyRunId(runId);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRunId("");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    setDeleteTarget(null);
    await runAction(target.id, () => api.deleteRun(target.id));
  };

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
      {error && <div className="inline-error">{error}</div>}
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
              <th className="run-actions-cell">操作</th>
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
                <td className="run-actions-cell">
                  <RunActions
                    run={run}
                    busy={busyRunId === run.id}
                    onPause={() => void runAction(run.id, () => api.pauseRun(run.id))}
                    onResume={() => void runAction(run.id, () => api.resumeRun(run.id))}
                    onDelete={() => {
                      setOpenMenuRunId("");
                      setDeleteTarget(run);
                    }}
                    open={openMenuRunId === run.id}
                    onToggle={() => setOpenMenuRunId((current) => (current === run.id ? "" : run.id))}
                    onClose={() => setOpenMenuRunId("")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState title="没有匹配的实例" description="调整筛选条件，或从工作流页面启动一次运行。" />}
      </section>
      {deleteTarget && (
        <DeleteRunModal
          run={deleteTarget}
          busy={busyRunId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

function RunActions({
  run,
  busy,
  onPause,
  onResume,
  onDelete,
  open,
  onToggle,
  onClose,
}: {
  run: RunRecord;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const runAndClose = (action: () => void) => {
    onClose();
    action();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  return (
    <div className="run-actions">
      <Link to={`/runs/${run.id}`}>查看</Link>
      <div className="run-actions-menu" ref={menuRef}>
        <button type="button" className="run-actions-trigger" disabled={busy} onClick={onToggle}>
          操作
          <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <div className="run-actions-popover">
            {run.status === "running" && <button type="button" onClick={() => runAndClose(onPause)}>暂停</button>}
            {run.status === "paused" && <button type="button" onClick={() => runAndClose(onResume)}>恢复</button>}
            <Link to={`/runs/${run.id}?tab=attach&autoAttach=1`} onClick={onClose}>接管</Link>
            <button type="button" className="danger-link" onClick={() => runAndClose(onDelete)}>删除</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteRunModal({
  run,
  busy,
  onCancel,
  onConfirm,
}: {
  run: RunRecord;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="delete-run-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="delete-run-title">删除实例</h2>
            <p>删除后会移除该实例记录和事件日志。运行中的实例会先结束执行会话。</p>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="关闭">x</button>
        </header>
        <div className="delete-summary">
          <span>运行 ID</span>
          <strong>{run.id}</strong>
          <span>工作流</span>
          <strong>{run.entryName}</strong>
          <span>状态</span>
          <strong>{run.status}</strong>
        </div>
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "删除中..." : "删除"}
          </button>
        </footer>
      </section>
    </div>
  );
}
