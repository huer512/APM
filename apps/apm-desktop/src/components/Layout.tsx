import { NavLink, Outlet } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { DaemonControl, daemonStateLabel } from "./DaemonControl";

export function Layout() {
  const { daemonStatus, updateState, installAvailableUpdate, dismissUpdate } = useApp();
  const ok = daemonStatus?.httpReachable || daemonStatus?.state === "running";
  const starting = daemonStatus?.state === "starting" || !daemonStatus;
  const availableUpdate = updateState.available;
  const showUpdateNotice =
    availableUpdate &&
    availableUpdate.version !== updateState.dismissedVersion &&
    !updateState.installing;
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
        <div className={`daemon-pill ${ok ? "ok" : starting ? "warn" : "err"}`}>
          <strong>Daemon {daemonStateLabel(daemonStatus?.state, ok)}</strong>
          <span>{daemonStatus?.message?.replace(/^Daemon 运行中\s*/, "") ?? "检查中..."}</span>
          <DaemonControl compact />
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
        </div>
      </aside>
      <main className="main">
        {showUpdateNotice && (
          <div className="notice update-notice">
            <div>
              <strong>发现新版本 {availableUpdate.version}</strong>
              <span>当前版本 {availableUpdate.currentVersion}</span>
            </div>
            <div className="notice-actions">
              <button type="button" className="primary" onClick={() => void installAvailableUpdate()}>
                下载并安装
              </button>
              <button type="button" onClick={dismissUpdate}>
                稍后
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
