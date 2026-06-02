import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../context/AppContext";

export function Layout() {
  const { daemonStatus, startDaemon, restartDaemon } = useApp();
  const ok = daemonStatus?.httpReachable ?? false;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">APM Desktop</div>
        <div className={`daemon-pill ${ok ? "ok" : "err"}`}>
          {daemonStatus?.message ?? "检查中…"}
        </div>
        <nav>
          <NavLink to="/" end>
            仪表盘
          </NavLink>
          <NavLink to="/runs">运行实例</NavLink>
          <NavLink to="/studio">配置工作室</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
        <div style={{ marginTop: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {!ok && (
            <button type="button" className="primary" onClick={() => void startDaemon()}>
              启动 Daemon
            </button>
          )}
          <button type="button" onClick={() => void restartDaemon()}>
            重启 Daemon
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
