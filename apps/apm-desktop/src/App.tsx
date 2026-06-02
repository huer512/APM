import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Runs } from "./pages/Runs";
import { RunDetail } from "./pages/RunDetail";
import { Studio } from "./pages/Studio";
import { Settings } from "./pages/Settings";

function AppRoutes() {
  const { loading, error } = useApp();

  if (loading) {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p>正在连接 APM…</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.15)",
            borderBottom: "1px solid var(--danger)",
            padding: "8px 16px",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:runId" element={<RunDetail />} />
          <Route path="studio" element={<Studio />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProvider>
  );
}
