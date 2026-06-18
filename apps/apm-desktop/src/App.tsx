import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Workflows } from "./pages/Workflows";
import { WorkflowView } from "./pages/WorkflowView";
import { Runs } from "./pages/Runs";
import { NewRun } from "./pages/NewRun";
import { RunDetail } from "./pages/RunDetail";
import { Studio } from "./pages/Studio";
import { Logs } from "./pages/Logs";
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
        <div className="notice danger">
          {error}
        </div>
      )}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/view/*" element={<WorkflowView />} />
          <Route path="new-run" element={<NewRun />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:runId" element={<RunDetail />} />
          <Route path="studio" element={<Studio />} />
          <Route path="hosts" element={<Navigate to="/studio?category=hosts" replace />} />
          <Route path="logs" element={<Logs />} />
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
