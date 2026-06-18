import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { openApmHome } from "../lib/desktop";
import { useApp } from "../context/AppContext";
import { PageHeader, StatusBadge } from "../components/UI";

export function Settings() {
  const { config, refresh, restartDaemon, context } = useApp();
  const [section, setSection] = useState<"connection" | "storage" | "logs">("connection");
  const [apiKey, setApiKey] = useState("");
  const [httpEnabled, setHttpEnabled] = useState(true);
  const [httpPort, setHttpPort] = useState(19740);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [logDefaultLimit, setLogDefaultLimit] = useState(200);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setApiKey(config.cursorApiKey ?? "");
      setHttpEnabled(config.http?.enabled !== false);
      setHttpPort(config.http?.port ?? 19740);
      setLogRetentionDays(config.logs?.retentionDays ?? 30);
      setLogDefaultLimit(config.logs?.defaultLimit ?? 200);
    }
  }, [config]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.updateConfig({
        cursorApiKey: apiKey,
        http: { enabled: httpEnabled, host: "127.0.0.1", port: httpPort },
        logs: {
          retentionDays: Math.max(0, Math.floor(logRetentionDays)),
          defaultLimit: Math.max(1, Math.floor(logDefaultLimit)),
        },
      });
      setMessage("已保存。若修改了 HTTP 端口，请重启 Daemon。");
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const httpBaseUrl = config?.httpBaseUrl ?? context?.httpBaseUrl ?? `http://127.0.0.1:${httpPort}`;
  const apmHome = context?.apmHome ?? config?.apmHome ?? "-";

  return (
    <div>
      <PageHeader
        title="设置"
        description="管理桌面端连接、Daemon HTTP API 和本地配置目录。"
        actions={
          <>
            <button type="button" onClick={() => void restartDaemon()}>
              重启 Daemon
            </button>
            <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "保存中..." : "保存设置"}
            </button>
          </>
        }
      />

      <div className="settings-layout">
        <aside className="settings-nav panel">
          <button type="button" className={section === "connection" ? "active" : ""} onClick={() => setSection("connection")}>
            连接与密钥
            <span>Cursor API Key、HTTP API</span>
          </button>
          <button type="button" className={section === "storage" ? "active" : ""} onClick={() => setSection("storage")}>
            本地目录
            <span>APM_HOME 和文件入口</span>
          </button>
          <button type="button" className={section === "logs" ? "active" : ""} onClick={() => setSection("logs")}>
            日志与事件
            <span>全局日志窗口和默认条数</span>
          </button>
        </aside>

        <section className="settings-main panel">
          {section === "connection" && (
            <>
              <div className="settings-section">
                <div className="settings-section-head">
                  <div>
                    <h2>Cursor API Key</h2>
                    <p>用于工作流执行时调用 Cursor SDK。密钥只保存在本机 APM_HOME 配置中。</p>
                  </div>
                  <StatusBadge status={config?.hasApiKey ? "ok" : "warn"} />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>API Key</strong>
                    <span>{config?.hasApiKey ? "已配置密钥，可继续运行工作流。" : "尚未配置密钥，运行真实 Agent 前需要填写。"}</span>
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="cursor_..."
                  />
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-head">
                  <div>
                    <h2>HTTP API</h2>
                    <p>桌面端通过本机 HTTP API 与 Daemon 通信。默认仅监听 127.0.0.1。</p>
                  </div>
                  <StatusBadge status={httpEnabled ? "ok" : "warn"} />
                </div>
                <div className="setting-row">
                  <div>
                    <strong>启用本机 HTTP API</strong>
                    <span>关闭后桌面端无法通过 HTTP 获取运行、日志和配置数据。</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={httpEnabled} onChange={(event) => setHttpEnabled(event.target.checked)} />
                    <span />
                  </label>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>端口</strong>
                    <span>修改端口后需要重启 Daemon 才会生效。</span>
                  </div>
                  <input
                    className="short-input"
                    type="number"
                    min={0}
                    max={65535}
                    value={httpPort}
                    onChange={(event) => setHttpPort(Number(event.target.value))}
                  />
                </div>
                <div className="setting-url">
                  <span>当前地址</span>
                  <code>{httpBaseUrl}</code>
                </div>
              </div>
            </>
          )}

          {section === "storage" && (
            <div className="settings-section">
              <div className="settings-section-head">
                <div>
                  <h2>APM_HOME</h2>
                  <p>工作流、Prompt、Stage、Host 和运行状态都保存在这个目录下。</p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>配置目录</strong>
                  <span className="path-text">{apmHome}</span>
                </div>
                <button type="button" onClick={() => void openApmHome()}>
                  打开目录
                </button>
              </div>
            </div>
          )}

          {section === "logs" && (
            <div className="settings-section">
              <div className="settings-section-head">
                <div>
                  <h2>日志与事件</h2>
                  <p>控制全局日志页面的滚动窗口。单个工作流运行详情中的执行日志会完整保留。</p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>全局日志保留天数</strong>
                  <span>超过该时间窗口的事件不会进入日志与事件页面；填 0 表示不过滤。</span>
                </div>
                <input
                  className="short-input"
                  type="number"
                  min={0}
                  value={logRetentionDays}
                  onChange={(event) => setLogRetentionDays(Number(event.target.value))}
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>默认加载条数</strong>
                  <span>日志与事件页面每次默认读取的最大事件数。</span>
                </div>
                <input
                  className="short-input"
                  type="number"
                  min={1}
                  value={logDefaultLimit}
                  onChange={(event) => setLogDefaultLimit(Number(event.target.value))}
                />
              </div>
            </div>
          )}

          {message && <div className="notice inline">{message}</div>}
        </section>

        <aside className="settings-side">
          <section className="panel">
            <h2>系统信息</h2>
            <dl className="detail-list">
              <dt>HTTP API</dt>
              <dd>{httpEnabled ? "已启用" : "已关闭"}</dd>
              <dt>Base URL</dt>
              <dd>{httpBaseUrl}</dd>
              <dt>APM_HOME</dt>
              <dd>{apmHome}</dd>
              <dt>日志窗口</dt>
              <dd>{logRetentionDays > 0 ? `${logRetentionDays} 天` : "不过滤"}</dd>
              <dt>开发模式</dt>
              <dd>{context?.devMode ? "是" : "否"}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>快速操作</h2>
            <div className="action-list">
              <button type="button" onClick={() => void restartDaemon()}>
                重启 Daemon
              </button>
              <button type="button" onClick={() => void openApmHome()}>
                打开配置目录
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
