import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bot, GitBranch, Minus, Move, Play, Plus, RotateCcw, Server } from "lucide-react";
import * as api from "../lib/api";
import type { HostDefinition, PromptDefinition, StageDefinition, WorkflowDetail } from "../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";
import { EmptyState, PageHeader, StatusBadge } from "../components/UI";

type GraphNode =
  | { id: string; kind: "entry"; name: string; path: string; x: number; y: number; host?: HostDefinition; entryStage?: string }
  | { id: string; kind: "stage"; name: string; path: string; x: number; y: number; data: StageDefinition; prompts: PromptDefinition[] };

interface GraphEdge {
  from: string;
  to: string;
  kind: "primary";
}

const nodeSize = { width: 248, height: 128 };

export function WorkflowView() {
  const params = useParams();
  const name = params["*"] ?? params.name ?? "";
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [viewport, setViewport] = useState({ x: 32, y: 32, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    setError("");
    void api.fetchWorkflow(name)
      .then((result) => {
        setWorkflow(result);
        setSelectedId("");
        setViewport({ x: 32, y: 32, scale: 1 });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [name]);

  const graph = useMemo(() => (workflow ? buildWorkflowGraph(workflow) : { nodes: [], edges: [] }), [workflow]);
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const bounds = graph.nodes.reduce(
    (acc, node) => ({
      width: Math.max(acc.width, node.x + nodeSize.width + 140),
      height: Math.max(acc.height, node.y + nodeSize.height + 140),
    }),
    { width: 1280, height: 720 },
  );

  const openNode = (node: GraphNode) => {
    const category = node.kind === "entry" ? "entries" : "stages";
    navigate(`/studio?category=${category}&file=${encodeURIComponent(node.path)}`);
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".workflow-node, .workflow-node-detail, .workflow-canvas-controls")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, startX: viewport.x, startY: viewport.y };
  };

  const pan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setViewport((current) => ({
      ...current,
      x: drag.startX + event.clientX - drag.x,
      y: drag.startY + event.clientY - drag.y,
    }));
  };

  const endPan = () => {
    dragRef.current = null;
  };

  const zoomBy = (delta: number) => {
    setViewport((current) => ({ ...current, scale: clamp(current.scale + delta, 0.55, 1.7) }));
  };

  const zoomWithWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -0.08 : 0.08);
  };

  return (
    <div className="workflow-view-page">
      <PageHeader
        title={workflow?.name ?? "工作流查看"}
        description={!workflow ? "查看工作流拓扑、阶段、Prompt 和主机配置。" : undefined}
        descriptionNode={workflow ? (
          <MarkdownContent
            content={normalizeWorkflowDescription(workflow.name, workflow.description)}
            className="workflow-description-markdown"
          />
        ) : undefined}
        actions={
          <>
            <Link className="button" to="/workflows">返回列表</Link>
            <Link className="button primary" to={`/new-run?workflow=${encodeURIComponent(name)}`}>运行</Link>
          </>
        }
      />

      {error && <div className="notice danger">{error}</div>}
      {!workflow && !error && <EmptyState title="正在加载工作流" />}
      {workflow && (
        <section className="panel workflow-graph-panel">
          <div className="workflow-graph-meta">
            <StatusBadge status={workflow.status} />
            <span>入口阶段 {workflow.entryStage ?? "-"}</span>
            <span>默认主机 {workflow.host ?? "-"}</span>
            <span>{workflow.stages.length} 个阶段</span>
            <span>{workflow.prompts.length} 个 Prompt</span>
          </div>
          <div
            className={`workflow-graph-canvas ${dragRef.current ? "panning" : ""}`}
            onPointerDown={beginPan}
            onPointerMove={pan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onWheel={zoomWithWheel}
          >
            <div className="workflow-canvas-controls">
              <span><Move size={14} /> 拖动画布</span>
              <button type="button" onClick={() => zoomBy(-0.12)} aria-label="缩小"><Minus size={16} /></button>
              <strong>{Math.round(viewport.scale * 100)}%</strong>
              <button type="button" onClick={() => zoomBy(0.12)} aria-label="放大"><Plus size={16} /></button>
              <button type="button" onClick={() => setViewport({ x: 32, y: 32, scale: 1 })} aria-label="重置视图"><RotateCcw size={16} /></button>
            </div>

            <div
              className="workflow-graph-layer"
              style={{
                width: bounds.width,
                height: bounds.height,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              }}
            >
              <svg className="workflow-graph-edges" width={bounds.width} height={bounds.height} viewBox={`0 0 ${bounds.width} ${bounds.height}`}>
                <defs>
                  <marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {graph.edges.map((edge, index) => renderEdge(edge, graph.nodes, index))}
              </svg>
              <div className="workflow-graph-nodes" style={{ width: bounds.width, height: bounds.height }}>
                {graph.nodes.map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    className={`workflow-node ${node.kind} ${selected?.id === node.id ? "selected" : ""}`}
                    style={{ left: node.x, top: node.y, width: nodeSize.width, height: nodeSize.height }}
                    onClick={() => setSelectedId(node.id)}
                    onDoubleClick={() => openNode(node)}
                    title="双击打开配置"
                  >
                    <span className="workflow-node-icon">{nodeIcon(node.kind)}</span>
                    <strong>{node.name}</strong>
                    <small>{nodeKindLabel(node.kind)}</small>
                    {node.kind === "entry" && (
                      <span className="workflow-node-meta">
                        <Server size={13} /> {node.host?.name ?? workflow.host ?? "未配置主机"}
                      </span>
                    )}
                    {node.kind === "stage" && (
                      <span className="workflow-node-prompt-list">
                        {node.prompts.length > 0
                          ? node.prompts.map((prompt) => <em key={prompt.name}>{prompt.name}</em>)
                          : <em>无提示词</em>}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <aside className="workflow-node-detail floating">
                <NodeDetail node={selected} onOpen={() => openNode(selected)} onClose={() => setSelectedId("")} />
              </aside>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function renderEdge(edge: GraphEdge, nodes: GraphNode[], index: number) {
  const from = nodes.find((node) => node.id === edge.from);
  const to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) {
    return null;
  }
  const x1 = from.x + nodeSize.width;
  const y1 = from.y + nodeSize.height / 2;
  const x2 = to.x;
  const y2 = to.y + nodeSize.height / 2;
  const mid = x1 + Math.max(70, (x2 - x1) / 2);
  return (
    <path
      key={`${edge.from}-${edge.to}-${index}`}
      className={edge.kind}
      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
      markerEnd="url(#workflow-arrow)"
    />
  );
}

function buildWorkflowGraph(workflow: WorkflowDetail): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const stagesByName = new Map(workflow.stages.map((stage) => [stage.name, stage]));
  const promptsByName = new Map(workflow.prompts.map((prompt) => [prompt.name, prompt]));
  const levels = computeStageLevels(workflow.entryStage, stagesByName);
  const baseY = 178;
  const nodes: GraphNode[] = [
    {
      id: `entry:${workflow.name}`,
      kind: "entry",
      name: workflow.name,
      path: workflow.path,
      host: workflow.hostDefinition,
      entryStage: workflow.entryStage,
      x: 80,
      y: baseY,
    },
  ];
  const edges: GraphEdge[] = [];
  const levelGroups = new Map<number, StageDefinition[]>();

  for (const stage of workflow.stages) {
    const level = levels.get(stage.name) ?? 0;
    levelGroups.set(level, [...(levelGroups.get(level) ?? []), stage]);
  }

  for (const [level, stages] of [...levelGroups.entries()].sort((a, b) => a[0] - b[0])) {
    stages.sort((a, b) => a.name.localeCompare(b.name));
    stages.forEach((stage, index) => {
      nodes.push({
        id: `stage:${stage.name}`,
        kind: "stage",
        name: stage.name,
        path: stage.path,
        data: stage,
        prompts: stage.prompts.map((prompt) => promptsByName.get(prompt)).filter((prompt): prompt is PromptDefinition => Boolean(prompt)),
        x: 410 + level * 390,
        y: baseY + index * 178,
      });
    });
  }

  if (workflow.entryStage && stagesByName.has(workflow.entryStage)) {
    edges.push({ from: `entry:${workflow.name}`, to: `stage:${workflow.entryStage}`, kind: "primary" });
  }
  for (const stage of workflow.stages) {
    for (const next of stage.nextStages) {
      if (stagesByName.has(next)) {
        edges.push({ from: `stage:${stage.name}`, to: `stage:${next}`, kind: "primary" });
      }
    }
  }
  return { nodes, edges };
}

function computeStageLevels(entryStage: string | undefined, stages: Map<string, StageDefinition>): Map<string, number> {
  const levels = new Map<string, number>();
  const queue: Array<{ name: string; level: number }> = [];
  if (entryStage && stages.has(entryStage)) {
    queue.push({ name: entryStage, level: 0 });
  }
  for (const stage of stages.keys()) {
    if (!levels.has(stage) && queue.length === 0) {
      queue.push({ name: stage, level: 0 });
    }
  }
  while (queue.length > 0) {
    const item = queue.shift()!;
    const current = levels.get(item.name);
    if (current !== undefined && current <= item.level) {
      continue;
    }
    levels.set(item.name, item.level);
    const stage = stages.get(item.name);
    for (const next of stage?.nextStages ?? []) {
      if (stages.has(next)) {
        queue.push({ name: next, level: item.level + 1 });
      }
    }
  }
  for (const stage of stages.keys()) {
    if (!levels.has(stage)) {
      levels.set(stage, 0);
    }
  }
  return levels;
}

function NodeDetail({ node, onOpen, onClose }: { node: GraphNode; onOpen: () => void; onClose: () => void }) {
  return (
    <>
      <div className="workflow-detail-head">
        <div className={`workflow-detail-icon ${node.kind}`}>{nodeIcon(node.kind)}</div>
        <div>
          <h2>{node.name}</h2>
          <p>{nodeKindLabel(node.kind)}</p>
        </div>
        <button type="button" className="workflow-detail-close" onClick={onClose} aria-label="关闭节点详情">×</button>
      </div>
      <dl className="detail-list">
        <dt>配置文件</dt>
        <dd>{node.path}</dd>
        {node.kind === "entry" && (
          <>
            <dt>入口阶段</dt>
            <dd>{node.entryStage ?? "-"}</dd>
            <dt>默认主机</dt>
            <dd>{node.host ? `${node.host.name} (${node.host.host})` : "-"}</dd>
            <dt>工作目录</dt>
            <dd>{node.host?.workspace ?? "-"}</dd>
          </>
        )}
        {node.kind === "stage" && (
          <>
            <dt>Prompt</dt>
            <dd>{node.prompts.map((prompt) => prompt.name).join(", ") || "-"}</dd>
            <dt>后继阶段</dt>
            <dd>{node.data.nextStages.join(", ") || "-"}</dd>
          </>
        )}
      </dl>
      <button type="button" className="primary" onClick={onOpen}>打开配置</button>
    </>
  );
}

function nodeIcon(kind: GraphNode["kind"]) {
  const size = 18;
  if (kind === "entry") return <Play size={size} />;
  if (kind === "stage") return <GitBranch size={size} />;
  return <Bot size={size} />;
}

function nodeKindLabel(kind: GraphNode["kind"]): string {
  return kind === "entry" ? "入口" : "阶段";
}

function normalizeWorkflowDescription(name: string, description: string): string {
  const fallback = "查看工作流拓扑、阶段、Prompt 和主机配置。";
  const lines = (description || fallback).split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return fallback;
  }
  const first = lines[firstContentIndex]!.trim();
  const heading = /^#\s+(.+)$/.exec(first);
  if (heading && heading[1].trim() === name) {
    return lines.slice(0, firstContentIndex).concat(lines.slice(firstContentIndex + 1)).join("\n").trim() || fallback;
  }
  return description || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
