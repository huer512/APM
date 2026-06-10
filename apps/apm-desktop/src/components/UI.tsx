import type { ReactNode } from "react";
import type { RunRecord } from "../lib/types";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: RunRecord["status"] | string }) {
  const label: Record<string, string> = {
    running: "运行中",
    paused: "等待人工",
    finished: "成功",
    failed: "失败",
    stopped: "已停止",
    valid: "可用",
    invalid: "无效",
    ok: "正常",
    warn: "警告",
    error: "错误",
  };
  return <span className={`badge ${status}`}>{label[status] ?? status}</span>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state panel">
      <strong>{title}</strong>
      {description && <span>{description}</span>}
    </div>
  );
}

export function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatDuration(start?: string, end?: string): string {
  if (!start) {
    return "-";
  }
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
