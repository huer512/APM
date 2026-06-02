import { useEffect, useState } from "react";
import * as api from "../lib/api";
import type { AttachSnapshot } from "../lib/types";

interface AttachPanelProps {
  runId: string;
}

export function AttachPanel({ runId }: AttachPanelProps) {
  const [snapshot, setSnapshot] = useState<AttachSnapshot | null>(null);
  const [selectedStage, setSelectedStage] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [toolOnly, setToolOnly] = useState(false);
  const [status, setStatus] = useState("");
  const [attached, setAttached] = useState(false);

  const load = async () => {
    const snap = await api.attachSnapshot(runId);
    setSnapshot(snap);
    const stages = Object.keys(snap.stagePrompts).sort();
    if (!selectedStage || !stages.includes(selectedStage)) {
      setSelectedStage(stages[0] ?? snap.run.currentStage ?? "");
    }
    const prompts = snap.stagePrompts[selectedStage] ?? [];
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

  const beginAttach = async () => {
    await api.attachBegin(runId);
    setAttached(true);
    setStatus("已进入 Attach 模式");
  };

  const endAttach = async () => {
    await api.attachEnd(runId);
    setAttached(false);
    setStatus("已退出 Attach 模式");
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
    return <p>加载 Attach 快照…</p>;
  }

  const promptsInStage = snapshot.stagePrompts[selectedStage] ?? [];
  const msgKey = selectedStage && selectedPrompt ? `${selectedStage}.${selectedPrompt}` : "";
  const messages = msgKey ? (snapshot.messageHistoryByStagePrompt[msgKey] ?? []) : [];
  const recentEvents = toolOnly
    ? snapshot.recentEvents.filter((e) => e.kind === "tool")
    : snapshot.recentEvents;

  return (
    <div>
      <div className="toolbar">
        {!attached ? (
          <button type="button" className="primary" onClick={() => void beginAttach()}>
            开始 Attach
          </button>
        ) : (
          <button type="button" onClick={() => void endAttach()}>
            结束 Attach
          </button>
        )}
        <button type="button" className="primary" onClick={() => void nextStage()}>
          下一阶段 (:next)
        </button>
        <label>
          <input type="checkbox" checked={toolOnly} onChange={(e) => setToolOnly(e.target.checked)} />
          仅 Tool 事件
        </label>
      </div>

      <p>
        状态: {snapshot.run.status} · 当前阶段: {snapshot.run.currentStage ?? "-"} · 等待下一步:{" "}
        {snapshot.run.waitingForNext ? "是" : "否"}
      </p>
      {status && <p style={{ color: "var(--text-muted)" }}>{status}</p>}

      <div className="attach-grid">
        <div className="card">
          <h4>阶段</h4>
          {Object.keys(snapshot.stagePrompts)
            .sort()
            .map((stage) => (
              <button
                key={stage}
                type="button"
                className={stage === selectedStage ? "active" : ""}
                onClick={() => setSelectedStage(stage)}
              >
                {stage === selectedStage ? "* " : ""}
                {stage}
              </button>
            ))}
          <h4 style={{ marginTop: 16 }}>Prompt</h4>
          {promptsInStage.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={prompt === selectedPrompt ? "active" : ""}
              onClick={() => setSelectedPrompt(prompt)}
            >
              {prompt === selectedPrompt ? "* " : ""}
              {prompt}
            </button>
          ))}
        </div>

        <div className="card">
          <h4>消息历史</h4>
          <div className="log-view" style={{ maxHeight: 200 }}>
            {messages.slice(-12).map((m, i) => (
              <div key={`${m.createdAt}-${i}`}>
                [{m.role}] {m.content}
              </div>
            ))}
            {messages.length === 0 && <span style={{ color: "var(--text-muted)" }}>暂无消息</span>}
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <input
              style={{ flex: 1 }}
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
        </div>
      </div>

      <div className="card">
        <h4>最近事件</h4>
        <div className="log-view">
          {recentEvents.slice(-25).map((ev) => (
            <div key={ev.seq}>
              [{ev.kind}] {JSON.stringify(ev.data)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
