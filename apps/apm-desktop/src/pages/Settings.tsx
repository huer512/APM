import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { openApmHome } from "../lib/desktop";
import { useApp } from "../context/AppContext";
import { PageHeader, StatusBadge } from "../components/UI";

export function Settings() {
  const { config, refresh, restartDaemon, context } = useApp();
  const [apiKey, setApiKey] = useState("");
  const [httpEnabled, setHttpEnabled] = useState(true);
  const [httpPort, setHttpPort] = useState(19740);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setApiKey(config.cursorApiKey ?? "");
      setHttpEnabled(config.http?.enabled !== false);
      setHttpPort(config.http?.port ?? 19740);
    }
  }, [config]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.updateConfig({
        cursorApiKey: apiKey,
        http: { enabled: httpEnabled, host: "127.0.0.1", port: httpPort },
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
        <section className="settings-main panel">
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
