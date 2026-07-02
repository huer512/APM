import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";

export function daemonStateLabel(state: string | undefined, reachable: boolean | undefined): string {
  if (state === "starting") {
    return "启动中";
  }
  if (reachable || state === "running") {
    return "运行中";
  }
  return "已停止";
}

export function DaemonControl({ compact = false }: { compact?: boolean }) {
  const { daemonStatus, daemonBusy, startDaemon, stopDaemon, restartDaemon } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const state = daemonStatus?.state;
  const running = daemonStatus?.httpReachable || state === "running";
  const starting = daemonBusy || state === "starting" || !daemonStatus;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (starting) {
    return (
      <div className={`daemon-actions ${compact ? "compact" : ""}`}>
        <button type="button" disabled>
          Daemon 启动中
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className={`daemon-actions ${compact ? "compact" : ""}`}>
        <div className="daemon-action-menu" ref={menuRef}>
          <button type="button" className="daemon-main-action" onClick={() => void restartDaemon()}>
            重启
          </button>
          <button
            type="button"
            className="daemon-more-action"
            aria-label="更多 Daemon 操作"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="daemon-action-popover">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void restartDaemon();
                }}
              >
                重启 Daemon
              </button>
              <button
                type="button"
                className="danger-link"
                onClick={() => {
                  setMenuOpen(false);
                  void stopDaemon();
                }}
              >
                停止 Daemon
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`daemon-actions ${compact ? "compact" : ""}`}>
      <button type="button" className="primary" onClick={() => void startDaemon()}>
        启动 Daemon
      </button>
    </div>
  );
}
