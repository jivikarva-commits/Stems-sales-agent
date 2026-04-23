import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Users, BriefcaseBusiness, TrendingUp, Zap, Phone, Mail, MessageCircle,
  ArrowUpRight, BarChart3, Activity
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";

function buildSparkline(activity, types = null) {
  const days = Array.from({ length: 12 }, (_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - (11 - idx));
    return {
      key: d.toISOString().slice(0, 10),
      name: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      value: 0,
    };
  });

  const map = new Map(days.map((d) => [d.key, d]));
  activity.forEach((item) => {
    if (types && !types.includes(item.agent_type)) return;
    const key = new Date(item.timestamp || Date.now()).toISOString().slice(0, 10);
    if (map.has(key)) map.get(key).value += 1;
  });

  return days.map((d) => ({ name: d.name, value: d.value }));
}

function StatsCard({ title, value, change, icon: Icon, color = "blue" }) {
  const colors = {
    blue: "bg-blue-500/15 text-blue-300",
    emerald: "bg-emerald-500/15 text-emerald-300",
    amber: "bg-amber-500/15 text-amber-300",
    violet: "bg-violet-500/15 text-violet-300",
  };

  return (
    <Card className="glass-card glass-hover rounded-2xl" data-testid={`stats-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] tracking-[0.12em] uppercase font-semibold text-slate-400 truncate">{title}</p>
            <p className="text-2xl sm:text-3xl font-mono font-semibold text-white mt-1 tabular-nums break-words">{value}</p>
            {change ? (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-emerald-300">
                <ArrowUpRight className="h-3 w-3" />
                <span className="font-mono tabular-nums">{change}</span>
              </div>
            ) : null}
          </div>
          <div className={`p-2 rounded-xl ${colors[color]}`}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SparklineCard({ title, subtitle, value, data, stroke, fill }) {
  const gradientId = `spark-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="glass-card rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-300 font-medium">{title}</p>
        <p className="text-[11px] font-mono text-slate-400 tabular-nums">{value}</p>
      </div>
      <div className="h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
                <stop offset="100%" stopColor={fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              cursor={false}
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10 }}
              labelStyle={{ color: "#94a3b8", fontSize: 11 }}
              itemStyle={{ color: "#ffffff", fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">{subtitle}</p>
    </div>
  );
}

function AgentLiveCard({ label, icon: Icon, accent, badge, preview, meta, active, onClick, showWave = false }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left glass-card glass-hover rounded-2xl p-4"
      data-testid={`agent-card-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accent}26` }}>
            <Icon className="h-4 w-4" style={{ color: accent }} />
          </div>
          <p className="text-sm font-semibold text-white">{label}</p>
        </div>
        <Badge className={active ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" : "bg-slate-700/60 text-slate-400 border-slate-600"}>
          {active ? badge : "Paused"}
        </Badge>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        {showWave ? (
          <div className="mb-2 flex items-center justify-between">
            <div className="wave-bars">
              <span /><span /><span /><span /><span /><span />
            </div>
            <span className="text-[10px] text-emerald-300">{active ? "In Call (AI Agent)" : "Standby"}</span>
          </div>
        ) : null}
        <p className="text-xs text-slate-200">{preview}</p>
        <p className="text-[11px] text-slate-400 mt-1">{meta}</p>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.get("/dashboard/stats"), api.get("/dashboard/activity"), api.get("/agents")])
      .then(([s, a, ag]) => {
        setStats(s.data);
        setActivity(a.data);
        setAgents(ag.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const agentMap = useMemo(() => {
    const m = {};
    agents.forEach((a) => { m[a.type] = a; });
    return m;
  }, [agents]);

  const leadsSeries = useMemo(() => buildSparkline(activity), [activity]);
  const dealsSeries = useMemo(() => buildSparkline(activity, ["email", "call"]), [activity]);
  const revenueSeries = useMemo(() => buildSparkline(activity, ["whatsapp"]), [activity]);

  const waPreview = activity.find((item) => item.agent_type === "whatsapp");
  const emailPreview = activity.find((item) => item.agent_type === "email");
  const callPreview = activity.find((item) => item.agent_type === "call");

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-slate-300 flex items-center gap-2">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-white" data-testid="dashboard-page">
      <div className="mb-5 sm:mb-6 flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-white">Dashboard</h1>
          <p className="text-sm font-medium text-slate-400 mt-1">Control center for your automation performance</p>
        </div>
        <div className="flex gap-2">
          <Button
            className="bg-blue-500 hover:bg-blue-600 text-white shadow-[0_0_22px_rgba(59,130,246,0.28)]"
            onClick={() => navigate("/campaigns")}
            data-testid="quick-action-new-campaign"
          >
            <BriefcaseBusiness className="h-4 w-4 mr-2" /> New Campaign
          </Button>
          <Button
            variant="outline"
            className="border-white/20 bg-white/5 hover:bg-white/10 text-slate-100"
            onClick={() => navigate("/reports")}
            data-testid="quick-action-view-reports"
          >
            <BarChart3 className="h-4 w-4 mr-2" /> Reports
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-5 sm:mb-6">
        <StatsCard title="Total Leads" value={stats?.total_leads || 0} change="+12.5% this month" icon={Users} color="emerald" />
        <StatsCard title="Active Deals" value={stats?.active_campaigns || 0} change="+2 this week" icon={BriefcaseBusiness} color="blue" />
        <StatsCard title="Conversion Rate" value={`${stats?.conversion_rate || 0}%`} change="+3.2% vs last month" icon={TrendingUp} color="amber" />
        <StatsCard title="Revenue" value={`${((stats?.revenue_generated || 0) / 100000).toFixed(1)}L`} change="+18% this month" icon={Zap} color="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card className="glass-card rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">Agent Activity (Real-time)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SparklineCard
                title="Total Leads"
                subtitle="Live lead engagement"
                value={(stats?.total_leads || 0).toLocaleString()}
                data={leadsSeries}
                stroke="#10B981"
                fill="#10B981"
              />
              <SparklineCard
                title="Active Deals"
                subtitle="Deals in motion"
                value={(stats?.active_campaigns || 0).toLocaleString()}
                data={dealsSeries}
                stroke="#3B82F6"
                fill="#3B82F6"
              />
              <SparklineCard
                title="Revenue"
                subtitle={`Revenue (${((stats?.revenue_generated || 0) / 100000).toFixed(1)}L)`}
                value={`${((stats?.revenue_generated || 0) / 100000).toFixed(1)}L`}
                data={revenueSeries}
                stroke="#F59E0B"
                fill="#F59E0B"
              />
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {activity.slice(0, 10).map((item, i) => {
                  const icons = { whatsapp: MessageCircle, email: Mail, call: Phone };
                  const colors = { whatsapp: "text-emerald-300 bg-emerald-500/15", email: "text-blue-300 bg-blue-500/15", call: "text-amber-300 bg-amber-500/15" };
                  const Icon = icons[item.agent_type] || Activity;
                  const clr = colors[item.agent_type] || "text-slate-300 bg-slate-700/50";
                  return (
                    <div key={i} className="flex items-start gap-3 py-3 border-b border-white/10 last:border-0" data-testid={`activity-item-${i}`}>
                      <div className={`p-1.5 rounded-md ${clr.split(" ")[1]}`}>
                        <Icon className={`h-3.5 w-3.5 ${clr.split(" ")[0]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 truncate">
                          <span className="font-medium text-white">{item.lead_name}</span>{" "}
                          <span className="text-slate-400">{item.company}</span>
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{item.content?.substring(0, 86)}</p>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap shrink-0">
                        {new Date(item.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                  );
                })}
                {activity.length === 0 ? <p className="text-sm text-slate-500 py-8 text-center">No recent activity</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="lg:col-span-1 hidden md:block">
          <Card className="glass-card rounded-2xl sticky top-24">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm tracking-[0.14em] uppercase text-slate-200">Automated Agents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AgentLiveCard
                label="WhatsApp Agent"
                icon={MessageCircle}
                accent="#10B981"
                badge="Active"
                active={agentMap.whatsapp?.status === "active"}
                preview={waPreview?.content || "No live conversation yet. Waiting for inbound replies..."}
                meta={waPreview ? `${waPreview.lead_name || "Lead"} • live conversation` : "Connect to start live previews"}
                onClick={() => navigate("/whatsapp")}
              />
              <AgentLiveCard
                label="Gmail Agent"
                icon={Mail}
                accent="#3B82F6"
                badge="Active"
                active={agentMap.email?.status === "active"}
                preview={emailPreview?.content || "No recent subject. New outreach emails will appear here."}
                meta={emailPreview ? `${emailPreview.lead_name || "Prospect"} • ${emailPreview.status || "recent"}` : "Idle • waiting for outbound send"}
                onClick={() => navigate("/email")}
              />
              <AgentLiveCard
                label="Phone Agent"
                icon={Phone}
                accent="#22C55E"
                badge="Active"
                active={agentMap.call?.status === "active"}
                preview={callPreview?.content || "Waveform standby. Calls and transcripts will stream here."}
                meta={callPreview ? `${callPreview.lead_name || "Prospect"} • ${callPreview.status || "recent call"}` : "No active call"}
                onClick={() => navigate("/calls")}
                showWave
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
