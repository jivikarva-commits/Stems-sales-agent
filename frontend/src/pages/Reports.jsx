import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { BarChart3, TrendingUp, Users, Phone, Mail, MessageCircle, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from "recharts";
import api from "../lib/api";

const COLORS = { WhatsApp: "#10B981", Email: "#3B82F6", Call: "#F59E0B" };

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState("month");

  const load = () => {
    setLoading(true);
    api.get("/reports")
      .then((r) => {
        setReports(r.data);
        if (r.data.length > 0) setActive(r.data[0]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/reports/generate", { period });
      setReports((prev) => [r.data, ...prev]);
      setActive(r.data);
    } catch (e) {
      console.error(e);
    }
    setGenerating(false);
  };

  if (loading) return <div className="p-8 text-slate-300">Loading reports...</div>;

  const m = active?.metrics || {};
  const agentPerf = m.agent_performance || [];
  const funnel = m.conversion_funnel || [];
  const timeline = (m.leads_over_time || []).slice(-14);

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-white" data-testid="reports-page">
      <div className="flex flex-wrap items-start sm:items-center justify-between gap-3 mb-5 sm:mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-white">Reports</h1>
          <p className="text-sm font-medium text-slate-400 mt-1">Performance analytics across all agents</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px] border-white/15 bg-white/[0.04] text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-card border-white/15 text-slate-100">
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={generating} className="bg-blue-500 hover:bg-blue-600 text-white shadow-[0_0_18px_rgba(59,130,246,0.25)]">
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
      </div>

      {reports.length > 1 ? (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setActive(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors border ${
                active?.id === r.id
                  ? "bg-blue-500/20 text-blue-100 border-blue-400/30"
                  : "bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.08]"
              }`}
            >
              {r.period} — {new Date(r.generated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-5 sm:mb-6">
            {[
              { label: "Leads Contacted", value: m.leads_contacted || 0, icon: Users, color: "bg-emerald-500/15 text-emerald-300" },
              { label: "Response Rate", value: `${m.response_rate || 0}%`, icon: TrendingUp, color: "bg-blue-500/15 text-blue-300" },
              { label: "Meetings Booked", value: m.meetings_booked || 0, icon: BarChart3, color: "bg-amber-500/15 text-amber-300" },
              { label: "Conversion Rate", value: `${m.conversion_rate || 0}%`, icon: TrendingUp, color: "bg-violet-500/15 text-violet-300" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="glass-card glass-hover rounded-2xl">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] tracking-[0.12em] uppercase font-semibold text-slate-400 truncate">{label}</p>
                      <p className="text-xl sm:text-2xl font-mono font-semibold text-white mt-1 tabular-nums break-words">{value}</p>
                    </div>
                    <div className={`p-2 rounded-xl ${color}`}>
                      <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="glass-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Leads Over Time (14 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={timeline}>
                    <defs>
                      <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#94A3B8" }}
                      tickFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10 }}
                      labelStyle={{ color: "#94A3B8", fontSize: 11 }}
                      itemStyle={{ color: "#fff", fontSize: 11 }}
                    />
                    <Area type="monotone" dataKey="count" stroke="#10B981" strokeWidth={2.2} fill="url(#leadsGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="glass-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Active Deals by Agent (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={agentPerf} barSize={34}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="agent" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} unit="%" />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10 }}
                      labelStyle={{ color: "#94A3B8", fontSize: 11 }}
                      itemStyle={{ fontSize: 11 }}
                    />
                    <Bar
                      dataKey="rate"
                      radius={[6, 6, 0, 0]}
                      fill="#3B82F6"
                      label={{ position: "top", fontSize: 10, fill: "#cbd5e1", formatter: (v) => `${v}%` }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Conversion Funnel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {funnel.map((stage, i) => {
                  const max = funnel[0]?.count || 1;
                  const pct = Math.round((stage.count / max) * 100);
                  const clrs = ["bg-blue-500", "bg-indigo-500", "bg-amber-500", "bg-orange-500", "bg-emerald-500"];
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">{stage.stage}</span>
                        <span className="font-mono text-slate-400 tabular-nums">{stage.count.toLocaleString()}</span>
                      </div>
                      <div className="h-2 bg-slate-800/80 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${clrs[i] || "bg-blue-500"} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="glass-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Agent Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agentPerf.map((a, i) => {
                    const icons = { WhatsApp: MessageCircle, Email: Mail, Call: Phone };
                    const Icon = icons[a.agent] || BarChart3;
                    const clr = COLORS[a.agent] || "#3B82F6";
                    return (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-white/10 last:border-0">
                        <div className="p-2 rounded-lg bg-white/10 shrink-0">
                          <Icon className="h-4 w-4" style={{ color: clr }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-200 font-medium">{a.agent}</span>
                            <span className="font-mono text-slate-400 tabular-nums">{a.sent.toLocaleString()} sent · {a.responses} replied</span>
                          </div>
                          <div className="h-1.5 bg-slate-800/90 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${a.rate}%`, backgroundColor: clr }} />
                          </div>
                        </div>
                        <Badge className="text-[10px] shrink-0" style={{ background: `${clr}22`, color: clr, border: "1px solid transparent" }}>
                          {a.rate}%
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card className="glass-card rounded-2xl">
          <CardContent className="p-12 text-center">
            <BarChart3 className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <p className="text-sm text-slate-400 mb-4">No data yet. Launch your first campaign to see reports.</p>
            <Button onClick={generate} disabled={generating} className="bg-blue-500 hover:bg-blue-600 text-white">
              <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generating..." : "Generate Report"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
