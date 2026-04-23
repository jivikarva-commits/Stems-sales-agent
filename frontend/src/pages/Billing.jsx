import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { CreditCard, Check, Phone, Mail, MessageCircle, Download, Zap } from "lucide-react";
import api from "../lib/api";

export default function Billing() {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/billing").then(r => setBilling(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Loading billing...</div>;

  const plan = billing?.current_plan;
  const plans = billing?.plans || [];
  const invoices = billing?.invoices || [];

  return (
    <div className="p-6 lg:p-8" data-testid="billing-page">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-slate-50 tracking-tight">Billing</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your subscription and usage</p>
      </div>

      {plan && (
        <Card className="bg-slate-800 border-blue-500/20 mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-500/10 rounded-lg"><CreditCard className="h-5 w-5 text-blue-400" /></div>
                <div>
                  <p className="text-lg font-heading font-semibold text-slate-50">{plan.name} Plan</p>
                  <p className="text-sm text-slate-400">
                    <span className="font-mono font-semibold text-blue-400 tabular-nums">{(plan.price / 1000).toFixed(0)}K</span>/month
                  </p>
                </div>
              </div>
              <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 hover:opacity-100">Current Plan</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Calls", icon: Phone, used: plan.calls_used, limit: plan.calls_limit, color: "amber" },
                { label: "Emails", icon: Mail, used: plan.emails_used, limit: plan.emails_limit, color: "blue" },
                { label: "WhatsApp", icon: MessageCircle, used: plan.whatsapp_used, limit: plan.whatsapp_limit, color: "emerald" },
              ].map(u => {
                const pct = Math.round((u.used / u.limit) * 100);
                const barColors = { amber: "bg-amber-500", blue: "bg-blue-500", emerald: "bg-emerald-500" };
                return (
                  <div key={u.label} className="bg-slate-900 rounded-lg p-3.5" data-testid={`usage-${u.label.toLowerCase()}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <u.icon className={`h-3.5 w-3.5 text-${u.color}-400`} />
                        <span className="text-xs text-slate-400">{u.label}</span>
                      </div>
                      <span className="text-xs font-mono text-slate-300 tabular-nums">{u.used.toLocaleString()}/{u.limit.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColors[u.color]} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <h2 className="text-base font-heading font-semibold text-slate-200 mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(p => {
            const isCurrent = p.name === plan?.name;
            const isEnterprise = p.name === "Enterprise";
            return (
              <Card key={p.name} className={`border ${isCurrent ? "bg-blue-500/5 border-blue-500/30" : "bg-slate-800 border-slate-700/50"}`} data-testid={`plan-card-${p.name.toLowerCase()}`}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-heading font-semibold text-slate-100">{p.name}</h3>
                    {isCurrent && <Badge className="bg-blue-500/10 text-blue-400 text-[10px] border-blue-500/20 hover:opacity-100">Current</Badge>}
                  </div>
                  <div className="mb-4">
                    <span className="text-2xl font-mono font-bold text-slate-50 tabular-nums">{(p.price / 1000).toFixed(0)}K</span>
                    <span className="text-sm text-slate-500">/month</span>
                  </div>
                  <div className="space-y-2 mb-4">
                    {p.features.map((f, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-sm text-slate-400">{f}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span className="text-sm text-slate-400">{isEnterprise ? "Unlimited calls" : `${p.calls.toLocaleString()} AI calls/month`}</span>
                    </div>
                  </div>
                  <Button
                    className={`w-full ${isCurrent ? "bg-slate-700 text-slate-400 cursor-default" : isEnterprise ? "bg-violet-500 hover:bg-violet-600 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"}`}
                    disabled={isCurrent}
                    data-testid={`select-plan-${p.name.toLowerCase()}`}
                  >
                    {isCurrent ? "Current Plan" : isEnterprise ? "Contact Sales" : "Upgrade"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-base font-heading font-semibold text-slate-200 mb-4">Invoice History</h2>
        <Card className="bg-slate-800 border-slate-700/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50 hover:bg-transparent">
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Period</TableHead>
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Amount</TableHead>
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv, i) => (
                  <TableRow key={i} className="border-slate-700/50" data-testid={`invoice-row-${i}`}>
                    <TableCell className="text-sm text-slate-200">{inv.period}</TableCell>
                    <TableCell className="text-sm font-mono text-slate-300 tabular-nums">{(inv.amount / 1000).toFixed(0)}K</TableCell>
                    <TableCell className="text-xs text-slate-500 font-mono tabular-nums">{new Date(inv.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                    <TableCell><Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:opacity-100">{inv.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-400 hover:text-slate-200" data-testid={`download-invoice-${i}`}>
                        <Download className="h-3 w-3 mr-1" /> PDF
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
