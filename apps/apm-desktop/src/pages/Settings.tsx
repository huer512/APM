import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { openApmHome } from "../lib/desktop";
import { useApp } from "../context/AppContext";

export function Settings() {
  const { config, refresh, restartDaemon, context } = useApp();
  const [apiKey, setApiKey] = useState("");
  const [httpEnabled, setHttpEnabled] = useState(true);
  const [httpPort, setHttpPort] = useState(19740);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (config) {
      setApiKey(config.cursorApiKey ?? "");
      setHttpEnabled(config.http?.enabled !== false);
      setHttpPort(config.http?.port ?? 19740);
    }
  }, [config]);

  const save = async () => {
    await api.updateConfig({
      cursorApiKey: apiKey,
      http: { enabled: httpEnabled, host: "127.0.0.1", port: httpPort },
    });
    setMessage("已保存。若修改了 HTTP 端口，请重启 Daemon。");
    await refresh();
  };

  return (
    <div>
      <h1 className="page-title">设置</h1>

      <div className="card">
        <h3>Cursor API Key</h3>
        <div className="form-row">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cursor_..."
            style={{ width: "100%", maxWidth: 480 }}
          />
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {config?.hasApiKey ? "已配置 API Key" : "尚未配置 API Key"}
        </p>
      </div>

      <div className="card">
        <h3>HTTP API（桌面客户端）</h3>
        <label>
          <input type="checkbox" checked={httpEnabled} onChange={(e) => setHttpEnabled(e.target.checked)} />
          启用本机 HTTP API
        </label>
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>端口</label>
          <input
            type="number"
            value={httpPort}
            onChange={(e) => setHttpPort(Number(e.target.value))}
            style={{ width: 120 }}
          />
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          当前地址: {config?.httpBaseUrl ?? context?.httpBaseUrl ?? "-"}
        </p>
      </div>

      <div className="card">
        <h3>目录</h3>
        <p>
          <code>{context?.apmHome ?? config?.apmHome}</code>
        </p>
        <button type="button" onClick={() => void openApmHome()}>
          在文件管理器中打开
        </button>
      </div>

      <div className="toolbar">
        <button type="button" className="primary" onClick={() => void save()}>
          保存设置
        </button>
        <button type="button" onClick={() => void restartDaemon()}>
          重启 Daemon
        </button>
      </div>
      {message && <p>{message}</p>}
    </div>
  );
}
