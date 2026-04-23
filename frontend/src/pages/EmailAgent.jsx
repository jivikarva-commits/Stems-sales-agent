import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Mail, CheckCircle, AlertCircle, Trash2 } from "lucide-react";
import api from "../lib/api";

const statusColors = {
  sent: "bg-slate-700/50 text-slate-400",
  opened: "bg-blue-500/10 text-blue-400",
  clicked: "bg-violet-500/10 text-violet-400",
  replied: "bg-emerald-500/10 text-emerald-400",
};

export default function EmailAgent() {
  const [agent, setAgent] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [setting, setSetting] = useState(false);
  const [editingSender, setEditingSender] = useState(false);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    Promise.all([api.get("/agents/email/status"), api.get("/email/logs")])
      .then(([a, l]) => {
        setAgent(a.data);
        const logList = Array.isArray(l.data) ? l.data : [];
        setLogs(logList);
        setEmail(a.data?.credentials?.email || "");
      })
      .catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSetup = async () => {
    setSetupError("");
    setSetting(true);
    try {
      const credentials = { email, provider: "gmail", domain_verified: true, smtp_host: "smtp.gmail.com" };
      if (appPassword.trim()) credentials.app_password = appPassword.trim();
      const res = await api.post("/agents/setup", { type: "email", credentials });
      setAgent(res.data);
      setEditingSender(false);
    } catch (e) {
      setSetupError(e?.response?.data?.detail || e?.message || "Email setup failed");
      console.error(e);
    }
    setSetting(false);
  };

  const handleToggle = async () => {
    try {
      const res = await api.put("/agents/email/toggle");
      setAgent(res.data);
    } catch (e) { console.error(e); }
  };

  const deleteLog = async (logId) => {
    if (!logId) return;
    const ok = window.confirm("Delete this email log?");
    if (!ok) return;
    try {
      await api.delete(`/email/logs/${encodeURIComponent(logId)}`);
      setLogs((prev) => prev.filter((l) => l.log_id !== logId));
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="p-8 text-slate-400">Loading Email Agent...</div>;

  return (
    <div className="p-6 lg:p-8" data-testid="email-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-slate-50 tracking-tight">Email Agent</h1>
          <p className="text-sm text-slate-400 mt-1">Manage email campaigns and automation</p>
        </div>
        {agent?.status === "active" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Agent Active</span>
            <Switch checked={agent?.status === "active"} onCheckedChange={handleToggle} data-testid="email-toggle" />
          </div>
        )}
      </div>

      {agent?.status === "setup_required" ? (
        <Card className="bg-slate-800 border-amber-500/20 mb-6">
          <CardContent className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />
              <div><p className="text-sm font-medium text-slate-200">Setup Required</p><p className="text-xs text-slate-400 mt-0.5">Configure your email sending credentials</p></div>
            </div>
            <div className="space-y-3 max-w-md">
              <div>
                <Label className="text-slate-300 text-sm">Sending Email Address</Label>
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="sales@yourcompany.com" className="mt-1 bg-slate-900 border-slate-700 text-slate-200" data-testid="email-address-input" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Gmail App Password</Label>
                <Input type="password" value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="mt-1 bg-slate-900 border-slate-700 text-slate-200" />
                <p className="text-[11px] text-slate-500 mt-1">Custom sender ke liye app password required hai.</p>
              </div>
              <Button onClick={handleSetup} disabled={!email || setting} className="bg-blue-500 hover:bg-blue-600 text-white" data-testid="email-connect-btn">
                {setting ? "Connecting..." : "Connect Email"}
              </Button>
              {setupError ? <p className="text-xs text-red-300">{setupError}</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-emerald-500/5 border-emerald-500/20 mb-6">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-400">Connected</p>
              <p className="text-xs text-slate-400">{agent?.credentials?.email} via {agent?.credentials?.provider} &mdash; Domain verified</p>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto text-slate-300 hover:text-blue-300" onClick={() => { setSetupError(""); setEditingSender((v) => !v); }}>
              {editingSender ? "Cancel" : "Change Sender"}
            </Button>
          </CardContent>
          {editingSender && (
            <CardContent className="pt-0 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="new sender email" className="bg-slate-900 border-slate-700 text-slate-200" />
                <Input type="password" value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="Gmail app password" className="bg-slate-900 border-slate-700 text-slate-200" />
                <Button onClick={handleSetup} disabled={!email || setting} className="bg-blue-500 hover:bg-blue-600 text-white">
                  {setting ? "Saving..." : "Save Sender"}
                </Button>
              </div>
              {setupError ? <p className="text-xs text-red-300 mt-2">{setupError}</p> : null}
              <p className="text-[11px] text-slate-500 mt-2">New Gmail se bhejna hai to us mailbox ka app password yahan set karo.</p>
            </CardContent>
          )}
        </Card>
      )}

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList className="bg-slate-800 border border-slate-700/50">
          <TabsTrigger value="logs" data-testid="tab-email-logs">Email Logs</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-email-templates">Templates</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-email-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                    <TableRow className="border-slate-700/50 hover:bg-transparent">
                      <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Lead</TableHead>
                      <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Subject</TableHead>
                      <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Date</TableHead>
                      <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {logs.slice(0, 15).map((log, i) => {
                    const ts = log.timestamp || log.sentAt || log.createdAt;
                    const dateStr = ts ? new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
                    return (
                    <TableRow key={log.log_id || i} className="border-slate-700/50" data-testid={`email-log-${i}`}>
                      <TableCell>
                        <p className="text-sm text-slate-200">{log.lead_name || log.to || "—"}</p>
                        <p className="text-xs text-slate-500">{log.lead_email || log.to || ""}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-300 max-w-[200px] truncate">{log.subject || log.content || "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono tabular-nums">{dateStr}</TableCell>
                      <TableCell><Badge className={`${statusColors[log.status] || statusColors.sent} hover:opacity-100`}>{log.status || "sent"}</Badge></TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-slate-400 hover:text-red-400"
                          onClick={() => deleteLog(log.log_id)}
                          disabled={!log.log_id}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {logs.length === 0 && <p className="text-sm text-slate-500 py-12 text-center">No emails sent yet</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { name: "Initial Outreach", subject: "Unlock 3x Sales Growth with AI Automation", preview: "Hi {name}, I noticed {company} is scaling rapidly..." },
              { name: "Follow-up Day 3", subject: "Quick follow-up on AI sales automation", preview: "Hi {name}, just wanted to check if you had a chance..." },
              { name: "Value Proposition", subject: "How {company} can save 40 hours/week", preview: "Hi {name}, companies similar to {company} have seen..." },
              { name: "Meeting Request", subject: "15 min call this week?", preview: "Hi {name}, based on our conversation, I think a quick demo would be valuable..." },
            ].map((t, i) => (
              <Card key={i} className="bg-slate-800 border-slate-700/50" data-testid={`email-template-${i}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-200">{t.name}</p>
                    <Badge variant="outline" className="border-slate-700 text-slate-500 text-[10px]">AI Generated</Badge>
                  </div>
                  <p className="text-xs text-blue-400 mb-1">Subject: {t.subject}</p>
                  <p className="text-xs text-slate-500">{t.preview}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardHeader><CardTitle className="text-base text-slate-200">Email Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-300 text-sm">Email Signature</Label>
                <Textarea defaultValue={"Best regards,\nAmit Kumar\nSales Director, AcmeCorp\n+91 98765 00001"} className="mt-1 bg-slate-900 border-slate-700 text-slate-200 h-24" data-testid="email-signature-input" />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-200">Follow-up Schedule</p>
                {["Day 3: First follow-up", "Day 7: Second follow-up with case study", "Day 14: Final follow-up"].map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-400">{s}</span>
                    <Switch defaultChecked data-testid={`followup-toggle-${i}`} />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <div><p className="text-sm text-slate-200">Unsubscribe Handling</p><p className="text-xs text-slate-500">Auto-remove leads who unsubscribe</p></div>
                <Switch defaultChecked data-testid="unsubscribe-toggle" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
