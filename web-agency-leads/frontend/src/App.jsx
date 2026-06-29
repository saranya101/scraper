import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth.jsx";
import AppLayout from "./layouts/AppLayout.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import AutomationPage from "./pages/AutomationPage.jsx";
import CrmPage from "./pages/CrmPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import EmailSettingsPage from "./pages/EmailSettingsPage.jsx";
import ImportPage from "./pages/ImportPage.jsx";
import LeadDetailPage from "./pages/LeadDetailPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OutreachPage from "./pages/OutreachPage.jsx";
import ScannerPage from "./pages/ScannerPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import WorkspaceDetailPage from "./pages/WorkspaceDetailPage.jsx";
import WorkspacesPage from "./pages/WorkspacesPage.jsx";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Opening dashboard...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="crm" element={<CrmPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="outreach" element={<OutreachPage />} />
        <Route path="emails" element={<Navigate to="/outreach" replace />} />
        <Route path="scanner" element={<ScannerPage />} />
        <Route path="workspaces" element={<WorkspacesPage />} />
        <Route path="workspaces/:industrySlug" element={<WorkspaceDetailPage />} />
        <Route path="leads/:id" element={<LeadDetailPage />} />
        <Route path="imports" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/email" element={<EmailSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
