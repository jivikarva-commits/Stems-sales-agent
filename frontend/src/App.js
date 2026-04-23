import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import GoogleLoginPage from "./pages/GoogleLoginPage";
import MainLayout from "./layouts/MainLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Campaigns from "./pages/Campaigns";
import WhatsAppAgent from "./pages/WhatsAppAgent";
import EmailAgent from "./pages/EmailAgent";
import CallAgent from "./pages/CallAgent";
import CRM from "./pages/CRM";
import Reports from "./pages/Reports";
import Insights from "./pages/Insights";
import Billing from "./pages/Billing";
import AgentSetupPage from "./pages/AgentSetupPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page — shown first when user opens the app */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<GoogleLoginPage />} />

        {/* Main dashboard — all inner pages inside MainLayout */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/whatsapp" element={<WhatsAppAgent />} />
            <Route path="/email" element={<EmailAgent />} />
            <Route path="/calls" element={<CallAgent />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/agent-setup" element={<AgentSetupPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
