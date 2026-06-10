import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { useApp } from "../context/AppContext";
import type { HostDefinition } from "../lib/types";
import { EmptyState, PageHeader, StatusBadge } from "../components/UI";

export function Hosts() {
  const { daemonStatus } = useApp();
  const [hosts, setHosts] = useState<HostDefinition[]>([]);
  const [selected, setSelected] = useState<HostDefinition | null>(null);

  const load = async () => {
    const list = await api.fetchHosts();
    setHosts(list);
    setSelected((current) => current ?? list[0] ?? null);
  };

  useEffect(() => {
    if (daemonStatus?.httpReachable) {
      void load();
    }
  }, [daemonStatus?.httpReachable]);

  return (
    <div>
      <PageHeader
        title="主机与连接"
        description="查看 APM_HOME 中配置的本机和远程执行环境。"
        actions={<button type="button" onClick={() => void load()}>刷新</button>}
      />
      <div className="split-layout">
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>主机名称</th>
                <th>地址</th>
                <th>Workspace</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr
                  key={host.name}
                  className={selected?.name === host.name ? "selected-row" : ""}
                  onClick={() => setSelected(host)}
                >
                  <td>{host.name}</td>
                  <td>{host.host}{host.port ? `:${host.port}` : ""}</td>
                  <td>{host.workspace}</td>
                  <td><StatusBadge status={host.status === "local" ? "ok" : "warn"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {hosts.length === 0 && <EmptyState title="暂无主机配置" description="在 hosts 目录中新建 Markdown 配置后会显示在这里。" />}
        </section>
        <aside className="detail-panel">
          <h3>主机详情</h3>
          {selected ? (
            <dl className="detail-list">
              <dt>名称</dt><dd>{selected.name}</dd>
              <dt>地址</dt><dd>{selected.host}{selected.port ? `:${selected.port}` : ""}</dd>
              <dt>Workspace</dt><dd>{selected.workspace}</dd>
              <dt>用户</dt><dd>{selected.username ?? "-"}</dd>
              <dt>Virtual Env</dt><dd>{selected.virtualEnv ?? "-"}</dd>
              <dt>配置文件</dt><dd>{selected.path}</dd>
            </dl>
          ) : (
            <p className="muted">选择一个主机查看详情。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
