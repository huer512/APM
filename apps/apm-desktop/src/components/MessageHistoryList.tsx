import { useState } from "react";
import type { RefObject } from "react";
import { MarkdownContent } from "./MarkdownContent";
import type { DisplayMessage, ToolDisplayGroup } from "../lib/messageDisplay";

interface MessageHistoryListProps {
  messages: DisplayMessage[];
  selectedPrompt?: string;
  className?: string;
  listRef?: RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  maxItems?: number;
}

export function MessageHistoryList({
  messages,
  selectedPrompt,
  className = "",
  listRef,
  onScroll,
  maxItems = 12,
}: MessageHistoryListProps) {
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<string, boolean>>({});
  const visibleMessages = maxItems > 0 ? messages.slice(-maxItems) : messages;

  return (
    <div
      className={`message-history-list ${className}`.trim()}
      ref={listRef}
      onScroll={onScroll}
    >
      {visibleMessages.map((item, index) => (
        item.type === "tool-group" ? (
          <ToolMessageGroup
            key={item.id}
            item={item}
            collapsed={collapsedToolGroups[item.id] ?? true}
            onToggle={() => setCollapsedToolGroups((current) => ({ ...current, [item.id]: !(current[item.id] ?? true) }))}
          />
        ) : (
          <article key={`${item.createdAt}-${index}`} className={item.role}>
            <header>
              <strong>{item.role}</strong>
              <span>{item.prompt ?? selectedPrompt ?? "-"}{item.count > 1 ? ` · 合并 ${item.count}` : ""}</span>
            </header>
            <MarkdownContent content={item.content} className="message-history-markdown" />
          </article>
        )
      ))}
      {messages.length === 0 && <div className="empty-state">暂无消息</div>}
    </div>
  );
}

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
          <span>{item.prompt ?? "tool"} · {item.items.length} 次连续调用</span>
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
