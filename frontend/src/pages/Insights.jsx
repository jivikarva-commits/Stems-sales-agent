import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { TrendingUp, Lightbulb, Shield, BarChart3 } from "lucide-react";
import api from "../lib/api";

const typeConfig = {
  market_trend: { icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  recommendation: { icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-500/10", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  competitor: { icon: Shield, color: "text-red-400", bg: "bg-red-500/10", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  best_practice: { icon: BarChart3, color: "text-emerald-400", bg: "bg-emerald-500/10", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

export default function Insights() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/insights").then(r => setInsights(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Loading insights...</div>;

  return (
    <div className="p-6 lg:p-8" data-testid="insights-page">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-slate-50 tracking-tight">Market Insights</h1>
        <p className="text-sm text-slate-400 mt-1">AI-generated market analysis and recommendations</p>
      </div>

      <div className="relative mb-8 rounded-lg overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(https://images.pexels.com/photos/12537427/pexels-photo-12537427.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-900/60" />
        <div className="relative p-8">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-blue-400 mb-2">Market Intelligence</p>
          <h2 className="text-xl sm:text-2xl font-heading font-bold text-slate-50 mb-2">Indian AI SaaS Market Report</h2>
          <p className="text-sm text-slate-300 max-w-xl">AI-powered sales automation adoption in India is growing at 47% YoY. Stay ahead with real-time market intelligence and competitor analysis.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map(insight => {
          const cfg = typeConfig[insight.type] || typeConfig.market_trend;
          const Icon = cfg.icon;
          return (
            <Card key={insight.id} className="bg-slate-800 border-slate-700/50 hover:border-slate-600 transition-colors" data-testid={`insight-card-${insight.type}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${cfg.bg} shrink-0`}>
                    <Icon className={`h-4 w-4 ${cfg.color}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`${cfg.badge} text-[10px] hover:opacity-100`}>{insight.type?.replace(/_/g, " ")}</Badge>
                      <span className="text-[10px] text-slate-500">{insight.source}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-200 mt-1.5">{insight.title}</h3>
                  </div>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{insight.content}</p>
                <p className="text-[10px] text-slate-500 mt-3 font-mono tabular-nums">
                  {new Date(insight.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {insights.length === 0 && (
        <Card className="bg-slate-800 border-slate-700/50">
          <CardContent className="p-12 text-center">
            <TrendingUp className="h-8 w-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No insights available yet. Insights are generated as your campaigns run.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
