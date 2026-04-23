import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Megaphone, MessageCircle, Mail, Phone,
  Users, BarChart3, TrendingUp, CreditCard, Zap, ChevronLeft, ChevronRight, Bell, Menu, X
} from "lucide-react";
import api from "../lib/api";

const navGroups = [
  { section: "MAIN", items: [
    { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { path: "/campaigns", label: "Campaigns", icon: Megaphone },
    { path: "/crm", label: "CRM", icon: Users },
    { path: "/reports", label: "Reports", icon: BarChart3 },
  ]},
  { section: "AGENTS", items: [
    { path: "/whatsapp", label: "WhatsApp", icon: MessageCircle, agent: "whatsapp" },
    { path: "/email", label: "Email", icon: Mail, agent: "email" },
    { path: "/calls", label: "Calls", icon: Phone, agent: "call" },
  ]},
  { section: "TOOLS", items: [
    { path: "/insights", label: "Insights", icon: TrendingUp },
    { path: "/billing", label: "Billing", icon: CreditCard },
  ]},
];

const topTabs = [
  { label: "Dashboard", path: "/dashboard", match: ["/dashboard"] },
  { label: "Reports", path: "/reports", match: ["/reports"] },
  { label: "CRM", path: "/crm", match: ["/crm"] },
  { label: "Automation", path: "/campaigns", match: ["/campaigns", "/whatsapp", "/email", "/calls", "/agent-setup"] },
  { label: "Billing", path: "/billing", match: ["/billing"] },
];

export default function MainLayout() {
  const [agents, setAgents] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [onboarding, setOnboarding] = useState({ checked: false, completed: true });
  const [profile, setProfile] = useState({
    name: localStorage.getItem("user_name") || "User",
    email: localStorage.getItem("user_email") || "",
    plan: "Starter",
  });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/agents").then(res => {
      const map = {};
      res.data.forEach(a => { map[a.type] = a.status; });
      setAgents(map);
    }).catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    api.get("/auth/me").then((res) => {
      const u = res.data || {};
      setProfile({
        name: u.name || localStorage.getItem("user_name") || "User",
        email: u.email || localStorage.getItem("user_email") || "",
        plan: u.plan || "Starter",
      });
      const completed = Boolean(u.onboarding_completed);
      localStorage.setItem("onboarding_completed", completed ? "true" : "false");
      setOnboarding({ checked: true, completed });
    }).catch(() => {
      setOnboarding((prev) => ({ ...prev, checked: true }));
    });
  }, [location.pathname]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!onboarding.checked) return;
    const completed = onboarding.completed || localStorage.getItem("onboarding_completed") === "true";
    if (!completed && location.pathname !== "/agent-setup") {
      navigate("/agent-setup", { replace: true });
      return;
    }
    if (completed && location.pathname === "/agent-setup") {
      navigate("/dashboard", { replace: true });
    }
  }, [onboarding.checked, onboarding.completed, location.pathname, navigate]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_e) {}
    localStorage.removeItem("session_id");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_name");
    localStorage.removeItem("user_picture");
    localStorage.removeItem("onboarding_completed");
    navigate("/login", { replace: true });
  };

  const desktopSidebarWidth = collapsed ? "w-20" : "w-[17.5rem]";
  const desktopMainOffset = collapsed ? "md:ml-20" : "md:ml-[17.5rem]";
  const isTopTabActive = (tab) => tab.match.some((prefix) => location.pathname.startsWith(prefix));
  const activeTopTab = topTabs.find(isTopTabActive);

  const renderSidebarNav = ({ compact = false } = {}) => (
    <nav className="flex-1 overflow-y-auto py-4 px-2">
      {navGroups.map((g) => (
        <div key={g.section} className="mb-5">
          {!compact && (
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-slate-500 px-3 mb-2">{g.section}</p>
          )}
          {g.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              data-testid={`sidebar-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mb-1 ${
                  isActive
                    ? "bg-blue-500/20 text-blue-200 border border-blue-400/30 shadow-[0_0_18px_rgba(59,130,246,0.22)]"
                    : "text-slate-300 hover:text-white hover:bg-white/10 border border-transparent"
                }`
              }
              title={compact ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!compact && <span className="flex-1 truncate">{item.label}</span>}
              {item.agent && !compact && (
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  agents[item.agent] === "active"
                    ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.75)] animate-pulse"
                    : agents[item.agent] === "paused"
                    ? "bg-amber-400"
                    : "bg-slate-600"
                }`} />
              )}
              {item.agent && compact && (
                <span className={`w-1.5 h-1.5 rounded-full absolute right-2 ${
                  agents[item.agent] === "active" ? "bg-emerald-400" : "bg-slate-600"
                }`} />
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="relative min-h-screen bg-[#0A0F1E] text-white overflow-x-hidden">
      <aside className={`${desktopSidebarWidth} hidden md:flex fixed inset-y-0 left-0 z-40 flex-col border-r border-white/10 bg-white/[0.04] backdrop-blur-2xl transition-all duration-300`}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-[0_0_18px_rgba(59,130,246,0.45)] flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-lg font-heading font-bold text-white whitespace-nowrap leading-tight">SalesAI Pro</p>
                <p className="text-[11px] text-slate-400 tracking-wide">Nexus Dashboard</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0 transition-colors"
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {renderSidebarNav({ compact: collapsed })}

        <div className="p-3 border-t border-white/10">
          <div className="glass-card rounded-xl p-2.5">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-blue-200">{(profile.name || "U").slice(0, 2).toUpperCase()}</span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{profile.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">{profile.plan} Plan</p>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={logout}
                className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                data-testid="logout-btn"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </aside>

      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!mobileSidebarOpen}
      >
        <button
          className="absolute inset-0 bg-black/60"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
        <aside className={`absolute left-0 top-0 h-full w-[85vw] max-w-[18rem] bg-[#0A0F1E] border-r border-white/15 backdrop-blur-2xl transform transition-transform duration-300 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-[0_0_18px_rgba(59,130,246,0.45)] flex items-center justify-center shrink-0">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-heading font-bold text-white whitespace-nowrap leading-tight">SalesAI Pro</p>
                <p className="text-[11px] text-slate-400 tracking-wide">Nexus Dashboard</p>
              </div>
            </div>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-300 shrink-0 transition-colors"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {renderSidebarNav()}

          <div className="p-3 border-t border-white/10">
            <div className="glass-card rounded-xl p-2.5">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-blue-200">{(profile.name || "U").slice(0, 2).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{profile.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">{profile.plan} Plan</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                data-testid="logout-btn-mobile"
              >
                Logout
              </button>
            </div>
          </div>
        </aside>
      </div>

      <main className={`${desktopMainOffset} min-w-0 flex-1 min-h-screen transition-all duration-300 overflow-x-hidden`}>
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0A0F1E]/90 backdrop-blur-xl">
          <div className="px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden h-11 w-11 rounded-xl border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4 m-auto" />
              </button>

              <div className="hidden lg:flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold text-white">NexusFlow</span>
              </div>

              <div className="md:hidden min-w-0">
                <p className="text-sm font-semibold text-white truncate">{activeTopTab?.label || "Dashboard"}</p>
              </div>

              <div className="hidden sm:flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-1 overflow-x-auto max-w-full">
                {topTabs.map((tab) => (
                  <button
                    key={tab.label}
                    onClick={() => navigate(tab.path)}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                      isTopTabActive(tab)
                        ? "bg-blue-500/20 text-blue-100 border border-blue-400/30 shadow-[0_0_16px_rgba(59,130,246,0.22)]"
                        : "text-slate-400 hover:text-slate-100 hover:bg-white/10"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <button className="relative h-11 w-11 rounded-xl border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
                <Bell className="h-4 w-4 m-auto" />
                <span className="status-dot absolute right-1.5 top-1.5" />
              </button>
              <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 max-w-[16rem]">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-[11px] font-semibold shrink-0">
                  {(profile.name || "U").slice(0, 2).toUpperCase()}
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-xs font-medium text-white truncate">{profile.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{profile.email || "workspace user"}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="transition-page max-w-full overflow-x-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
