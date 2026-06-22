import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import * as api from "../lib/api";
import type { AttachSnapshot, RunDetailResponse, WorkflowDetail } from "../lib/types";
import { MarkdownContent } from "../components/MarkdownContent";
import { buildDisplayMessages } from "../lib/messageDisplay";
import type { MessageLike, ToolDisplayGroup } from "../lib/messageDisplay";

interface AttachPanelProps {
  runId: string;
}

export function AttachPanel({ runId }: AttachPanelProps) {
  const [snapshot, setSnapshot] = useState<AttachSnapshot | null>(null);
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [selectedStage, setSelectedStage] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<string, boolean>>({});
  const [autoAttachStarted, setAutoAttachStarted] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const [messagePinned, setMessagePinned] = useState(true);

  const load = async () => {
    const [snap, runDetail] = await Promise.all([
      api.attachSnapshot(runId),
      api.fetchRunDetail(runId).catch(() => null),
    ]);
    const workflowDetail = await api.fetchWorkflow(snap.run.entryName).catch(() => null);
    setSnapshot(snap);
    setDetail(runDetail);
    setWorkflow(workflowDetail);
    const stages = getOrderedStageItems(snap, runDetail, workflowDetail).map((stage) => stage.name);
    if (!selectedStage || !stages.includes(selectedStage)) {
      setSelectedStage((snap.run.currentStage && stages.includes(snap.run.currentStage) ? snap.run.currentStage : stages[0]) ?? "");
    }
    const nextStage = selectedStage && stages.includes(selectedStage) ? selectedStage : (stages[0] ?? snap.run.currentStage ?? "");
    const prompts = workflowDetail?.stages.find((stage) => stage.name === nextStage)?.prompts
      ?? runDetail?.stages.find((stage) => stage.name === nextStage)?.prompts
      ?? snap.stagePrompts[nextStage]
      ?? [];
    if (!selectedPrompt || !prompts.includes(selectedPrompt)) {
      setSelectedPrompt(snap.run.currentPrompt ?? prompts[0] ?? "");
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [runId, selectedStage, selectedPrompt]);

  useEffect(() => {
    setAutoAttachStarted(false);
  }, [runId]);

  useEffect(() => {
    if (!snapshot || snapshot.run.id !== runId || snapshot.run.attachMode || autoAttachStarted) {
      return;
    }
    setAutoAttachStarted(true);
    void api.attachBegin(runId)
      .then(async () => {
        setStatus("已自动进入接管模式");
        await load();
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "自动接管失败");
      });
  }, [snapshot?.run.attachMode, snapshot?.run.id, autoAttachStarted, runId]);

  usePinnedScroll(messageListRef, messagePinned, [selectedStage, selectedPrompt, snapshot?.messageHistoryByStagePrompt]);

  const endAttach = async () => {
    await api.attachEnd(runId);
    setAutoAttachStarted(true);
    setStatus("已退出接管模式");
    await load();
  };

  const sendMessage = async () => {
    if (!selectedPrompt || !message.trim()) {
      return;
    }
    const result = await api.attachMessage(runId, selectedPrompt, message.trim());
    setMessage("");
    setStatus(`Agent: ${result.output.slice(0, 200)}`);
    await load();
  };

  const nextStage = async () => {
    await api.attachNext(runId);
    setStatus("已请求进入下一阶段");
    await load();
  };

  if (!snapshot) {
    return <div className="panel attach-loading">加载接管快照...</div>;
  }

  const stageItems = getOrderedStageItems(snapshot, detail, workflow);
  const promptsInStage = stageItems.find((stage) => stage.name === selectedStage)?.prompts ?? snapshot.stagePrompts[selectedStage] ?? [];
  const msgKey = selectedStage && selectedPrompt ? `${selectedStage}.${selectedPrompt}` : "";
  const messages = msgKey ? (snapshot.messageHistoryByStagePrompt[msgKey] ?? []) : [];
  const displayMessages = buildDisplayMessages(messages);
  const attached = snapshot.run.attachMode;

  return (
    <div className="attach-panel">
      <section className="attach-control-panel">
        <div className="attach-state-grid">
          <div>
            <span>运行状态</span>
            <strong className={`attach-state ${snapshot.run.status}`}>{snapshot.run.status}</strong>
          </div>
          <div>
            <span>当前阶段</span>
            <strong>{snapshot.run.currentStage ?? "-"}</strong>
          </div>
          <div>
            <span>等待下一步</span>
            <strong>{snapshot.run.waitingForNext ? "是" : "否"}</strong>
          </div>
          <div>
            <span>接管状态</span>
            <strong>{attached ? "已接管" : "未接管"}</strong>
          </div>
        </div>
        <div className="attach-actions">
          <button type="button" onClick={() => void endAttach()} disabled={!attached}>
            退出接管
          </button>
          <button type="button" className="primary" onClick={() => void nextStage()}>
            下一阶段 (:next)
          </button>
        </div>
        {status && <div className="attach-status">{status}</div>}
      </section>

      <div className="attach-grid">
        <section className="panel attach-nav-card">
          <div className="attach-nav-section">
            <h3>阶段</h3>
            <div className="attach-choice-list">
              {stageItems
                .map((stage) => {
                  const state = getStageVisualState(stage.name, stage.status, snapshot);
                  return (
                  <button
                    key={stage.name}
                    type="button"
                    className={`${stage.name === selectedStage ? "active" : ""} ${state}`}
                    onClick={() => setSelectedStage(stage.name)}
                  >
                    <span>{stage.name}</span>
                    <small>{stageStatusLabel(state)} · {stage.prompts.length} prompts</small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="attach-nav-section">
            <h3>Prompt</h3>
            <div className="attach-choice-list">
              {promptsInStage.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={prompt === selectedPrompt ? "active" : ""}
                  onClick={() => setSelectedPrompt(prompt)}
                >
                  <span>{prompt}</span>
                  <small>{prompt === snapshot.run.currentPrompt ? "当前 Agent" : "可选择"}</small>
                </button>
              ))}
              {promptsInStage.length === 0 && <div className="empty-state">当前阶段暂无 Prompt</div>}
            </div>
          </div>
        </section>

        <section className="panel attach-message-card">
          <div className="section-head">
            <h2>消息历史</h2>
            <span className="muted">{displayMessages.length} 组 / 原始 {messages.length} 条</span>
          </div>
          <div
            className="attach-message-list"
            ref={messageListRef}
            onScroll={() => setMessagePinned(isNearBottom(messageListRef.current))}
          >
            {displayMessages.slice(-12).map((item, i) => (
              item.type === "tool-group" ? (
                <ToolMessageGroup
                  key={item.id}
                  item={item}
                  collapsed={collapsedToolGroups[item.id] ?? true}
                  onToggle={() => setCollapsedToolGroups((current) => ({ ...current, [item.id]: !(current[item.id] ?? true) }))}
                />
              ) : (
                <article key={`${item.createdAt}-${i}`} className={item.role}>
                  <header>
                  <strong>{item.role}</strong>
                  <span>{selectedPrompt || "-"}{item.count > 1 ? ` · 合并 ${item.count}` : ""}</span>
                </header>
                  <MarkdownContent content={item.content} className="attach-markdown" />
                </article>
              )
            ))}
            {displayMessages.length === 0 && <div className="empty-state">暂无消息</div>}
          </div>
          <div className="attach-composer">
            <input
              placeholder={`向 ${selectedPrompt || "prompt"} 发送消息`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void sendMessage();
                }
              }}
            />
            <button type="button" className="primary" onClick={() => void sendMessage()}>
              发送 (:msg)
            </button>
          </div>
        </section>
      </div>

    </div>
  );
}

type AttachMessage = MessageLike;
type StageItem = { name: string; status: string; prompts: string[] };

function ToolMessageGroup({
  item,
  collapsed,
  onToggle,
}: {
  item: ToolDisplayGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="tool-group">
      <header>
        <div>
          <strong>工具调用</strong>
          <span>{item.items.length} 次连续调用</span>
        </div>
        <button type="button" onClick={onToggle}>
          {collapsed ? "展开" : "收起"}
        </button>
      </header>
      {!collapsed && (
        <div className="tool-call-list">
          {item.items.map((message, index) => {
            const parsed = parseToolMessage(message.content);
            return (
              <div className="tool-call-card" key={`${message.createdAt}-${index}`}>
                <div>
                  <strong>{parsed.name}</strong>
                  <span>{parsed.status}</span>
                </div>
                <code>{parsed.detail}</code>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function parseToolMessage(content: string): { name: string; status: string; detail: string } {
  const match = content.match(/^\[tool:([^\]]+)\]\s+([^\s]+)\s*([\s\S]*)$/);
  if (!match) {
    return { name: "tool", status: "event", detail: content };
  }
  return {
    name: match[1],
    status: match[2],
    detail: match[3] || "-",
  };
}

function inferStageStatus(stage: string, snapshot: AttachSnapshot): string {
  if (snapshot.run.activeBatch.includes(stage) || snapshot.run.currentStage === stage) {
    return "running";
  }
  if ((snapshot.promptHistoryByStage[stage]?.length ?? 0) > 0) {
    return "finished";
  }
  return "pending";
}

function getOrderedStageItems(
  snapshot: AttachSnapshot,
  detail: RunDetailResponse | null,
  workflow: WorkflowDetail | null,
): StageItem[] {
  const byName = new Map<string, StageItem>();
  for (const stage of workflow?.stages ?? []) {
    byName.set(stage.name, {
      name: stage.name,
      status: inferStageStatus(stage.name, snapshot),
      prompts: stage.prompts,
    });
  }
  for (const stage of detail?.stages ?? []) {
    const found = byName.get(stage.name);
    byName.set(stage.name, {
      name: stage.name,
      status: stage.status,
      prompts: found?.prompts.length ? found.prompts : stage.prompts,
    });
  }
  for (const stage of Object.keys(snapshot.stagePrompts)) {
    if (!byName.has(stage)) {
      byName.set(stage, {
        name: stage,
        status: inferStageStatus(stage, snapshot),
        prompts: snapshot.stagePrompts[stage] ?? [],
      });
    }
  }
  return [...byName.values()];
}

function getStageVisualState(stage: string, status: string, snapshot: AttachSnapshot): "current" | "completed" | "failed" | "pending" {
  if (snapshot.run.activeBatch.includes(stage) || snapshot.run.currentStage === stage || status === "running") {
    return "current";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "finished" || (snapshot.promptHistoryByStage[stage]?.length ?? 0) > 0) {
    return "completed";
  }
  return "pending";
}

function stageStatusLabel(state: "current" | "completed" | "failed" | "pending"): string {
  if (state === "current") {
    return "正在执行";
  }
  if (state === "completed") {
    return "已执行";
  }
  if (state === "failed") {
    return "失败";
  }
  return "待执行";
}

function usePinnedScroll(
  ref: RefObject<HTMLElement | null>,
  pinned: boolean,
  deps: unknown[],
): void {
  useEffect(() => {
    if (!pinned || !ref.current) {
      return;
    }
    ref.current.scrollTop = ref.current.scrollHeight;
  }, deps);
}

function isNearBottom(element: HTMLElement | null): boolean {
  if (!element) {
    return true;
  }
  return element.scrollHeight - element.scrollTop - element.clientHeight < 24;
}
