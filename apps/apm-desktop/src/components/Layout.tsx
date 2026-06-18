import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../context/AppContext";

export function Layout() {
  const { daemonStatus, startDaemon, restartDaemon } = useApp();
  const ok = daemonStatus?.httpReachable ?? false;
  const navItems = [
    { to: "/", label: "总览", end: true },
    { to: "/workflows", label: "工作流" },
    { to: "/runs", label: "实例列表" },
    { to: "/studio", label: "配置管理" },
    { to: "/logs", label: "日志与事件" },
    { to: "/settings", label: "设置" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">APM Desktop</div>
        <div className={`daemon-pill ${ok ? "ok" : "err"}`}>
          <strong>{ok ? "Daemon 运行中" : "Daemon 未响应"}</strong>
          <span>{daemonStatus?.message?.replace(/^Daemon 运行中\s*/, "") ?? "检查中..."}</span>
          <button type="button" onClick={() => void restartDaemon()}>
            重启 Daemon
          </button>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span>R</span>
            <div>
              <strong>root</strong>
              <small>管理员</small>
            </div>
          </div>
          {!ok && (
            <button type="button" className="primary" onClick={() => void startDaemon()}>
              启动 Daemon
            </button>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
