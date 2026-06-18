import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Play, Plus, Search, Server, SlidersHorizontal, Trash2, Workflow } from "lucide-react";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { HostDefinition, WorkflowSummary } from "../lib/types";
import { EmptyState, PageHeader, StatusBadge } from "../components/UI";

interface ParamRow {
  key: string;
  value: string;
}

function rowsFromVariables(variables: Record<string, unknown> = {}): ParamRow[] {
  return Object.entries(variables).map(([key, value]) => ({
    key,
    value: value == null ? "" : String(value),
  }));
}

function paramsFromRows(rows: ParamRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0),
  );
}

export function NewRun() {
  const { daemonStatus } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedWorkflow = searchParams.get("workflow") ?? "";
  const requestedAttach = searchParams.get("attach") === "1";

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [hosts, setHosts] = useState<HostDefinition[]>([]);
  const [workflowName, setWorkflowName] = useState(requestedWorkflow);
  const [hostName, setHostName] = useState("");
  const [workflowQuery, setWorkflowQuery] = useState("");
  const [hostQuery, setHostQuery] = useState("");
  const [paramRows, setParamRows] = useState<ParamRow[]>([]);
  const [attach, setAttach] = useState(requestedAttach);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    void Promise.all([api.fetchWorkflows(), api.fetchHosts()])
      .then(([workflowList, hostList]) => {
        setWorkflows(workflowList);
        setHosts(hostList);
        const firstValid = workflowList.find((workflow) => workflow.status === "valid") ?? workflowList[0];
        const selected = workflowList.find((workflow) => workflow.name === requestedWorkflow) ?? firstValid;
        if (selected) {
          setWorkflowName(selected.name);
          setHostName(selected.host ?? "");
          setParamRows(rowsFromVariables(selected.variables));
        }
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)));
  }, [daemonStatus?.httpReachable, requestedWorkflow]);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.name === workflowName),
    [workflowName, workflows],
  );

  const selectedHost = useMemo(
    () => hosts.find((host) => host.name === hostName),
    [hostName, hosts],
  );

  const filteredWorkflows = useMemo(() => {
    const query = workflowQuery.trim().toLowerCase();
    if (!query) {
      return workflows;
    }
    return workflows.filter((workflow) =>
      [workflow.name, workflow.description, workflow.entryStage, workflow.host]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [workflowQuery, workflows]);

  const filteredHosts = useMemo(() => {
    const query = hostQuery.trim().toLowerCase();
    if (!query) {
      return hosts;
    }
    return hosts.filter((host) =>
      [host.name, host.host, host.workspace, host.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [hostQuery, hosts]);

  const selectWorkflow = (workflow: WorkflowSummary) => {
    setWorkflowName(workflow.name);
    setHostName(workflow.host ?? "");
    setParamRows(rowsFromVariables(workflow.variables));
    setError("");
  };

  const updateParam = (index: number, patch: Partial<ParamRow>) => {
    setParamRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const addParam = () => {
    setParamRows((rows) => [...rows, { key: "", value: "" }]);
  };

  const removeParam = (index: number) => {
    setParamRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const startRun = async () => {
    if (!selectedWorkflow) {
      setError("请选择工作流。");
      return;
    }
    if (selectedWorkflow.status !== "valid") {
      setError(selectedWorkflow.error ?? "当前工作流不可运行。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { runId } = await api.createRun({
        entryName: selectedWorkflow.name,
        params: paramsFromRows(paramRows),
        hostName: hostName || selectedWorkflow.host,
        detach: true,
        attach,
      });
      navigate(`/runs/${runId}${attach ? "?tab=attach" : ""}`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="new-run-page">
      <PageHeader
        title="新建运行"
        description="选择工作流、执行主机和运行参数，然后启动一个新的实例。"
        actions={
          <>
            <Link className="button" to="/runs">返回实例列表</Link>
            <button type="button" className="primary" disabled={busy || !selectedWorkflow} onClick={() => void startRun()}>
              <Play size={16} />
              {attach ? "启动并接管" : "启动运行"}
            </button>
          </>
        }
      />

      {error && <div className="notice danger inline">{error}</div>}

      <div className="new-run-layout">
        <section className="panel new-run-main">
          <div className="run-section">
            <div className="section-heading">
              <span><Workflow size={16} /></span>
              <div>
                <h2>选择工作流</h2>
                <p>从 APM_HOME 的入口配置中选择一个可运行工作流。</p>
              </div>
            </div>
            <div className="picker-toolbar">
              <Search size={16} />
              <input
                value={workflowQuery}
                onChange={(event) => setWorkflowQuery(event.target.value)}
                placeholder="搜索工作流名称、说明、入口阶段或主机..."
              />
              <span>{filteredWorkflows.length} / {workflows.length}</span>
            </div>
            <div className="workflow-picker">
              {filteredWorkflows.map((workflow) => (
                <button
                  key={workflow.name}
                  type="button"
                  className={workflow.name === workflowName ? "selected" : ""}
                  onClick={() => selectWorkflow(workflow)}
                >
                  <span className="picker-icon"><Workflow size={18} /></span>
                  <div>
                    <strong>{workflow.name}</strong>
                    <span>{workflow.description || "暂无说明"}</span>
                    <small>入口 {workflow.entryStage ?? "-"} · 默认主机 {workflow.host ?? "-"}</small>
                  </div>
                  <StatusBadge status={workflow.status} />
                </button>
              ))}
            </div>
            {workflows.length === 0 && <EmptyState title="暂无工作流" description="请先在配置管理中创建入口配置。" />}
            {workflows.length > 0 && filteredWorkflows.length === 0 && (
              <EmptyState title="没有匹配的工作流" description="调整搜索关键词后再试。" />
            )}
          </div>

          <div className="run-section">
            <div className="section-heading">
              <span><Server size={16} /></span>
              <div>
                <h2>执行主机</h2>
                <p>默认使用入口配置中的主机，也可以为本次运行临时覆盖。</p>
              </div>
            </div>
            <div className="picker-toolbar">
              <Search size={16} />
              <input
                value={hostQuery}
                onChange={(event) => setHostQuery(event.target.value)}
                placeholder="搜索主机名称、地址、用户或工作目录..."
              />
              <span>{filteredHosts.length} / {hosts.length}</span>
            </div>
            <div className="host-picker">
              {filteredHosts.map((host) => (
                <button
                  key={host.name}
                  type="button"
                  className={host.name === hostName ? "selected" : ""}
                  onClick={() => setHostName(host.name)}
                >
                  <span className="picker-icon"><Server size={18} /></span>
                  <div>
                    <strong>{host.name}</strong>
                    <span>{host.host}{host.username ? ` · ${host.username}` : ""}</span>
                    <small>{host.workspace}</small>
                  </div>
                </button>
              ))}
            </div>
            {hosts.length > 0 && filteredHosts.length === 0 && (
              <EmptyState title="没有匹配的主机" description="调整搜索关键词后再试。" />
            )}
          </div>

          <div className="run-section">
            <div className="section-heading">
              <span><SlidersHorizontal size={16} /></span>
              <div>
                <h2>运行参数</h2>
                <p>这些参数会作为本次运行变量传入，覆盖入口配置中的默认值。</p>
              </div>
            </div>
            <div className="param-editor">
              {paramRows.map((row, index) => (
                <div key={`${index}-${row.key}`} className="param-row">
                  <input
                    value={row.key}
                    onChange={(event) => updateParam(index, { key: event.target.value })}
                    placeholder="参数名"
                  />
                  <input
                    value={row.value}
                    onChange={(event) => updateParam(index, { value: event.target.value })}
                    placeholder="参数值"
                  />
                  <button type="button" onClick={() => removeParam(index)} title="删除参数">
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              ))}
              <button type="button" onClick={addParam}>
                <Plus size={16} />
                添加参数
              </button>
            </div>
          </div>

          <div className="run-section">
            <div className="section-heading">
              <span><Play size={16} /></span>
              <div>
                <h2>运行方式</h2>
                <p>普通启动会进入后台运行；接管启动会在运行开始后进入人工介入页面。</p>
              </div>
            </div>
            <div className="run-mode-cards">
              <button type="button" className={!attach ? "selected" : ""} onClick={() => setAttach(false)}>
                <span className="picker-icon"><Play size={18} /></span>
                <div>
                  <strong>后台运行</strong>
                  <span>启动后跳转到实例详情，流程自动执行。</span>
                </div>
              </button>
              <button type="button" className={attach ? "selected" : ""} onClick={() => setAttach(true)}>
                <span className="picker-icon"><Bot size={18} /></span>
                <div>
                  <strong>启动并接管</strong>
                  <span>启动后打开接管视图，可向当前 Agent 发送补充说明。</span>
                </div>
              </button>
            </div>
          </div>
        </section>

        <aside className="panel run-summary">
          <h2>运行摘要</h2>
          <dl>
            <dt>工作流</dt>
            <dd>{selectedWorkflow?.name ?? "-"}</dd>
            <dt>入口阶段</dt>
            <dd>{selectedWorkflow?.entryStage ?? "-"}</dd>
            <dt>执行主机</dt>
            <dd>{selectedHost?.name ?? (hostName || selectedWorkflow?.host || "-")}</dd>
            <dt>工作目录</dt>
            <dd>{selectedHost?.workspace ?? "-"}</dd>
            <dt>参数</dt>
            <dd>{Object.keys(paramsFromRows(paramRows)).length} 个</dd>
            <dt>运行方式</dt>
            <dd>{attach ? "启动并接管" : "后台运行"}</dd>
          </dl>
          {selectedWorkflow?.error && <div className="notice danger inline">{selectedWorkflow.error}</div>}
        </aside>
      </div>
    </div>
  );
}
