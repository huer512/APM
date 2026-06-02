import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../lib/api";
import * as desktop from "../lib/desktop";
import type { ConfigResponse, DaemonStatus, DesktopContext } from "../lib/types";

interface AppContextValue {
  context: DesktopContext | null;
  config: ConfigResponse | null;
  daemonStatus: DaemonStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshDaemon: () => Promise<void>;
  startDaemon: () => Promise<void>;
  stopDaemon: () => Promise<void>;
  restartDaemon: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<DesktopContext | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDaemon = useCallback(async () => {
    const status = await desktop.getDaemonStatus();
    setDaemonStatus(status);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ctx = await desktop.getDesktopContext();
      setContext(ctx);
      if (ctx.httpBaseUrl && ctx.httpToken) {
        api.setApiCredentials(ctx.httpBaseUrl, ctx.httpToken);
        await api.fetchHealth();
        const cfg = await api.fetchConfig();
        setConfig(cfg);
        if (!ctx.httpBaseUrl && cfg.httpBaseUrl) {
          api.setApiCredentials(cfg.httpBaseUrl, ctx.httpToken);
        }
      }
      await refreshDaemon();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshDaemon]);

  const startDaemon = useCallback(async () => {
    await desktop.startDaemon();
    const ctx = await desktop.getDesktopContext();
    setContext(ctx);
    if (ctx.httpBaseUrl && ctx.httpToken) {
      api.setApiCredentials(ctx.httpBaseUrl, ctx.httpToken);
    }
    await refresh();
  }, [refresh]);

  const stopDaemon = useCallback(async () => {
    await desktop.stopDaemon();
    await refreshDaemon();
  }, [refreshDaemon]);

  const restartDaemon = useCallback(async () => {
    await desktop.restartDaemon();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refreshDaemon();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, refreshDaemon]);

  const value = useMemo(
    () => ({
      context,
      config,
      daemonStatus,
      loading,
      error,
      refresh,
      refreshDaemon,
      startDaemon,
      stopDaemon,
      restartDaemon,
    }),
    [
      context,
      config,
      daemonStatus,
      loading,
      error,
      refresh,
      refreshDaemon,
      startDaemon,
      stopDaemon,
      restartDaemon,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used within AppProvider");
  }
  return ctx;
}
