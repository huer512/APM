import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { importMinimalTemplate, openApmHome } from "../lib/desktop";
import { useApp } from "../context/AppContext";
import type { DesktopSummary } from "../lib/types";
import { EmptyState, PageHeader, StatCard, StatusBadge, formatDate, formatDuration } from "../components/UI";

export function Dashboard() {
  const { daemonStatus, context, config, startDaemon, restartDaemon } = useApp();
  const [summary, setSummary] = useState<DesktopSummary | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!daemonStatus?.httpReachable) {
      return;
    }
    setSummary(await api.fetchSummary());
  };

  useEffect(() => {
    void load();
  }, [daemonStatus?.httpReachable]);

  const counts = summary?.counts;

  return (
    <div>
      <PageHeader
        title="总览"
        actions={
          <>
            <button type="button" onClick={() => void load()}>刷新</button>
            <Link className="button primary" to="/new-run">新建运行</Link>
          </>
        }
      />

      {!daemonStatus?.httpReachable && (
        <section className="panel hero-panel">
          <h2>Daemon 未响应</h2>
          <p>桌面端需要本机 Daemon 提供运行、日志、配置和接管 API。</p>
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => void startDaemon()}>启动 Daemon</button>
            <button type="button" onClick={() => void restartDaemon()}>重启 Daemon</button>
          </div>
        </section>
      )}

      <div className="stat-grid">
        <StatCard label="Daemon 状态" value={daemonStatus?.httpReachable ? "运行中" : "未响应"} detail={summary?.daemon.httpBaseUrl ?? context?.httpBaseUrl ?? "-"} tone={daemonStatus?.httpReachable ? "success" : "danger"} />
        <StatCard label="工作流数量" value={counts?.workflows ?? 0} detail="entries" tone="accent" />
        <StatCard label="当前运行" value={(counts?.running ?? 0) + (counts?.paused ?? 0)} detail={`等待人工 ${counts?.waitingForInput ?? 0}`} tone="warning" />
        <StatCard label="今日失败" value={counts?.failed ?? 0} detail={`已停止 ${counts?.stopped ?? 0}`} tone={(counts?.failed ?? 0) > 0 ? "danger" : "neutral"} />
        <StatCard label="主机配置" value={counts?.hosts ?? 0} detail="hosts" />
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-head">
            <h2>最近运行</h2>
            <Link to="/runs">查看全部</Link>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>工作流</th>
                <th>状态</th>
                <th>阶段</th>
                <th>耗时</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.recentRuns ?? []).map((run) => (
                <tr key={run.id}>
                  <td><Link to={`/runs/${run.id}`}>{run.id}</Link></td>
                  <td>{run.entryName}</td>
                  <td><StatusBadge status={run.status} /></td>
                  <td>{run.currentStage ?? "-"}</td>
                  <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td>{formatDate(run.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(summary?.recentRuns.length ?? 0) === 0 && <EmptyState title="暂无运行记录" description="从工作流页面启动一次运行后会显示在这里。" />}
        </section>

        <aside className="side-stack">
          <section className="panel">
            <h2>系统健康检查</h2>
            <div className="health-list">
              {(summary?.health ?? []).map((item) => (
                <div key={item.name}>
                  <StatusBadge status={item.status} />
                  <span>{item.name}</span>
                  <strong>{item.detail}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>快速操作</h2>
            <div className="action-list">
              <button type="button" onClick={() => void openApmHome()}>打开配置目录</button>
              <button
                type="button"
                onClick={() =>
                  void importMinimalTemplate().then((msg) => {
                    setMessage(msg);
                    void load();
                  })
                }
              >
                导入 minimal 模板
              </button>
              <Link className="button" to="/studio">编辑配置</Link>
            </div>
            {message && <p className="muted">{message}</p>}
            <p className="muted">APM_HOME: {summary?.daemon.apmHome ?? context?.apmHome ?? config?.apmHome ?? "-"}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
