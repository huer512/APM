import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { WorkflowSummary } from "../lib/types";
import { EmptyState, PageHeader, StatusBadge } from "../components/UI";

export function Workflows() {
  const { daemonStatus } = useApp();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    setWorkflows(await api.fetchWorkflows());
  };

  useEffect(() => {
    if (daemonStatus?.httpReachable) {
      void load();
    }
  }, [daemonStatus?.httpReachable]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return workflows;
    }
    return workflows.filter((workflow) =>
      [workflow.name, workflow.description, workflow.entryStage, workflow.host]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [query, workflows]);

  const runWorkflow = async (workflow: WorkflowSummary, attach = false) => {
    setBusy(workflow.name);
    setStatus("");
    try {
      const params = Object.fromEntries(
        Object.entries(workflow.variables ?? {}).map(([key, value]) => [key, value ?? ""]),
      );
      const { runId } = await api.createRun({
        entryName: workflow.name,
        params,
        detach: !attach,
        attach,
      });
      navigate(`/runs/${runId}${attach ? "?tab=attach" : ""}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      <PageHeader
        title="工作流列表"
        description="管理和运行 APM_HOME 中的 Agent 工作流。"
        actions={
          <>
            <button type="button" onClick={() => void load()}>
              刷新
            </button>
            <Link className="button primary" to="/studio">
              新建 / 编辑
            </Link>
          </>
        }
      />
      <div className="toolbar surface-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索工作流名称、描述、主机..."
        />
      </div>
      {status && <div className="notice danger inline">{status}</div>}
      <div className="workflow-grid">
        {filtered.map((workflow) => (
          <article key={workflow.name} className="workflow-card">
            <div className="workflow-card-head">
              <div>
                <h3>{workflow.name}</h3>
                <p>{workflow.description || "暂无说明"}</p>
              </div>
              <StatusBadge status={workflow.status} />
            </div>
            <div className="meta-grid">
              <span>入口阶段</span>
              <strong>{workflow.entryStage ?? "-"}</strong>
              <span>默认主机</span>
              <strong>{workflow.host ?? "-"}</strong>
              <span>参数数</span>
              <strong>{Object.keys(workflow.variables ?? {}).length}</strong>
            </div>
            {workflow.error && <p className="danger-text">{workflow.error}</p>}
            <div className="card-actions">
              <button
                type="button"
                className="primary"
                disabled={workflow.status !== "valid" || busy === workflow.name}
                onClick={() => void runWorkflow(workflow)}
              >
                运行
              </button>
              <button
                type="button"
                disabled={workflow.status !== "valid" || busy === workflow.name}
                onClick={() => void runWorkflow(workflow, true)}
              >
                Attach 运行
              </button>
              <Link to={`/studio?category=entries&file=${encodeURIComponent(workflow.path)}`}>编辑</Link>
            </div>
          </article>
        ))}
      </div>
      {filtered.length === 0 && <EmptyState title="暂无工作流" description="请先导入模板或在工作流工作室中新建 entry。" />}
    </div>
  );
}
