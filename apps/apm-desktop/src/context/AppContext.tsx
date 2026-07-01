import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../lib/api";
import * as desktop from "../lib/desktop";
import type { ConfigResponse, DaemonStatus, DesktopContext, UpdateState } from "../lib/types";

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
  updateState: UpdateState;
  checkUpdates: () => Promise<void>;
  installAvailableUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<DesktopContext | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({
    checking: false,
    installing: false,
    available: null,
    lastCheckedAt: null,
    downloadedBytes: 0,
    contentLength: null,
    error: null,
    dismissedVersion: null,
  });
  const checkedOnStartup = useRef(false);

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
    setError(null);
    try {
      await desktop.startDaemon();
      const ctx = await desktop.getDesktopContext();
      setContext(ctx);
      if (ctx.httpBaseUrl && ctx.httpToken) {
        api.setApiCredentials(ctx.httpBaseUrl, ctx.httpToken);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshDaemon();
    }
  }, [refresh, refreshDaemon]);

  const stopDaemon = useCallback(async () => {
    await desktop.stopDaemon();
    await refreshDaemon();
  }, [refreshDaemon]);

  const restartDaemon = useCallback(async () => {
    setError(null);
    try {
      await desktop.restartDaemon();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshDaemon();
    }
  }, [refresh, refreshDaemon]);

  const checkUpdates = useCallback(async () => {
    setUpdateState((current) => ({ ...current, checking: true, error: null }));
    try {
      const available = await desktop.checkForUpdate();
      setUpdateState((current) => ({
        ...current,
        checking: false,
        available,
        lastCheckedAt: new Date().toISOString(),
        downloadedBytes: 0,
        contentLength: null,
        error: null,
        dismissedVersion:
          available && current.dismissedVersion && available.version !== current.dismissedVersion
            ? null
            : current.dismissedVersion,
      }));
    } catch (err) {
      setUpdateState((current) => ({
        ...current,
        checking: false,
        lastCheckedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const installAvailableUpdate = useCallback(async () => {
    setUpdateState((current) => ({
      ...current,
      installing: true,
      downloadedBytes: 0,
      contentLength: null,
      error: null,
    }));
    try {
      await desktop.installUpdate((event) => {
        setUpdateState((current) => {
          if (event.event === "Started") {
            return { ...current, contentLength: event.data.contentLength ?? null, downloadedBytes: 0 };
          }
          if (event.event === "Progress") {
            return { ...current, downloadedBytes: current.downloadedBytes + event.data.chunkLength };
          }
          return current;
        });
      });
      await desktop.restartApp();
    } catch (err) {
      setUpdateState((current) => ({
        ...current,
        installing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateState((current) => ({
      ...current,
      dismissedVersion: current.available?.version ?? current.dismissedVersion,
    }));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refreshDaemon();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, refreshDaemon]);

  useEffect(() => {
    if (loading || checkedOnStartup.current) {
      return;
    }
    checkedOnStartup.current = true;
    void checkUpdates();
  }, [checkUpdates, loading]);

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
      updateState,
      checkUpdates,
      installAvailableUpdate,
      dismissUpdate,
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
      updateState,
      checkUpdates,
      installAvailableUpdate,
      dismissUpdate,
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
