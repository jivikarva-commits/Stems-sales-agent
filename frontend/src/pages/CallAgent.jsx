import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { CheckCircle, AlertCircle, Play, FileText, PhoneCall, Trash2, RefreshCw } from "lucide-react";
import api from "../lib/api";

const outcomeColors = {
  completed: "bg-emerald-500/10 text-emerald-400",
  interested: "bg-blue-500/10 text-blue-400",
  callback_scheduled: "bg-violet-500/10 text-violet-400",
  no_answer: "bg-slate-700/50 text-slate-400",
  voicemail: "bg-amber-500/10 text-amber-400",
};

const emptyConnectForm = {
  provider_mode: "twilio_vapi",
  vapi_api_key: "",
  vapi_assistant_id: "",
  vapi_phone_number_id: "",
  twilio_account_sid: "",
  twilio_auth_token: "",
  twilio_phone_number: "",
};

export default function CallAgent() {
  const [agent, setAgent] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingCall, setTestingCall] = useState(false);
  const [connectForm, setConnectForm] = useState(emptyConnectForm);
  const [connectedConfig, setConnectedConfig] = useState(null);
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [testCallTo, setTestCallTo] = useState("");
  const [testCallName, setTestCallName] = useState("Test Lead");
  const [transcript, setTranscript] = useState(null);
  const [recording, setRecording] = useState(null);

  const isTwilioMode = connectForm.provider_mode === "twilio_vapi";
  const isConnected = connectedConfig?.status === "active";
  const maskedCredentials = useMemo(() => connectedConfig?.credentials || {}, [connectedConfig]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [agentRes, logsRes, cfgRes] = await Promise.all([
        api.get("/agents/call/status"),
        api.get("/calls/logs"),
        api.get("/calls/config"),
      ]);
      setAgent(agentRes.data || null);
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
      setConnectedConfig(cfgRes.data || null);
      if (cfgRes.data?.provider_mode) {
        setConnectForm((prev) => ({ ...prev, provider_mode: cfgRes.data.provider_mode }));
      }
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Failed to load call agent data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggle = async () => {
    try {
      const res = await api.put("/agents/call/toggle");
      setAgent(res.data);
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Failed to toggle call agent");
    }
  };

  const handleConnect = async () => {
    setFormError("");
    setFormMessage("");
    setSavingConfig(true);
    try {
      const payload = {
        provider_mode: connectForm.provider_mode,
        vapi_api_key: connectForm.vapi_api_key,
        vapi_assistant_id: connectForm.vapi_assistant_id,
        vapi_phone_number_id: connectForm.vapi_phone_number_id,
        twilio_account_sid: connectForm.twilio_account_sid,
        twilio_auth_token: connectForm.twilio_auth_token,
        twilio_phone_number: connectForm.twilio_phone_number,
      };
      const { data } = await api.post("/connect-call-agent", payload);
      setConnectedConfig(data);
      const refreshedAgent = await api.get("/agents/call/status");
      setAgent(refreshedAgent.data || null);
      setConnectForm((prev) => ({
        ...prev,
        vapi_api_key: "",
        twilio_auth_token: "",
      }));
      setFormMessage("Call agent connected successfully.");
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Failed to connect call agent");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestCall = async () => {
    if (!testCallTo.trim()) {
      setFormError("Please enter a destination phone number for test call");
      return;
    }
    setFormError("");
    setFormMessage("");
    setTestingCall(true);
    try {
      await api.post("/start-call", {
        phone: testCallTo.trim(),
        name: testCallName.trim() || "Test Lead",
        retry_attempts: 2,
      });
      const [logsRes] = await Promise.all([api.get("/calls/logs")]);
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
      setFormMessage("Test call initiated.");
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Failed to start test call");
    } finally {
      setTestingCall(false);
    }
  };

  const deleteCallLog = async (logId) => {
    if (!logId) return;
    const ok = window.confirm("Delete this call log?");
    if (!ok) return;
    try {
      await api.delete(`/calls/logs/${encodeURIComponent(logId)}`);
      setLogs((prev) => prev.filter((l) => l.log_id !== logId));
      if (recording?.log_id === logId) setRecording(null);
      if (transcript?.log_id === logId) setTranscript(null);
    } catch (error) {
      setFormError(error?.response?.data?.detail || "Failed to delete call log");
    }
  };

  if (loading) return <div className="p-8 text-slate-400">Loading Call Agent...</div>;

  return (
    <div className="p-6 lg:p-8" data-testid="call-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-slate-50 tracking-tight">Call Agent</h1>
          <p className="text-sm text-slate-400 mt-1">Connect Vapi + Twilio (or direct Vapi) and run AI voice calls.</p>
        </div>
        {agent?.status === "active" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Agent Active</span>
            <Switch checked={agent?.status === "active"} onCheckedChange={handleToggle} data-testid="call-toggle" />
          </div>
        )}
      </div>

      <Card className={`mb-6 ${isConnected ? "bg-emerald-500/5 border-emerald-500/20" : "bg-slate-800 border-amber-500/20"}`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            {isConnected ? <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5" /> : <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />}
            <div>
              <p className={`text-sm font-medium ${isConnected ? "text-emerald-400" : "text-slate-200"}`}>
                {isConnected ? "Connected" : "Setup Required"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {isConnected
                  ? `Mode: ${maskedCredentials.provider_mode === "twilio_vapi" ? "Twilio + Vapi" : "Direct Vapi"}`
                  : "Connect your credentials to activate your personal call agent."}
              </p>
            </div>
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}
          {formMessage && <p className="text-xs text-emerald-400">{formMessage}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-300 text-sm">Connection Mode</Label>
              <Select
                value={connectForm.provider_mode}
                onValueChange={(value) => setConnectForm((prev) => ({ ...prev, provider_mode: value }))}
              >
                <SelectTrigger className="mt-1 bg-slate-900 border-slate-700 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="twilio_vapi">Twilio + Vapi</SelectItem>
                  <SelectItem value="vapi_direct">Direct Vapi Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Vapi API Key</Label>
              <Input
                value={connectForm.vapi_api_key}
                onChange={(e) => setConnectForm((prev) => ({ ...prev, vapi_api_key: e.target.value }))}
                placeholder={maskedCredentials.vapi_api_key || "Enter Vapi private key"}
                className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
                type="password"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Vapi Assistant ID</Label>
              <Input
                value={connectForm.vapi_assistant_id}
                onChange={(e) => setConnectForm((prev) => ({ ...prev, vapi_assistant_id: e.target.value }))}
                placeholder={maskedCredentials.vapi_assistant_id || "assistant_..."}
                className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Vapi Phone Number ID</Label>
              <Input
                value={connectForm.vapi_phone_number_id}
                onChange={(e) => setConnectForm((prev) => ({ ...prev, vapi_phone_number_id: e.target.value }))}
                placeholder={maskedCredentials.vapi_phone_number_id || "pn_..."}
                className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
              />
            </div>
            {isTwilioMode && (
              <>
                <div>
                  <Label className="text-slate-300 text-sm">Twilio Account SID</Label>
                  <Input
                    value={connectForm.twilio_account_sid}
                    onChange={(e) => setConnectForm((prev) => ({ ...prev, twilio_account_sid: e.target.value }))}
                    placeholder={maskedCredentials.twilio_account_sid || "AC..."}
                    className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 text-sm">Twilio Auth Token</Label>
                  <Input
                    value={connectForm.twilio_auth_token}
                    onChange={(e) => setConnectForm((prev) => ({ ...prev, twilio_auth_token: e.target.value }))}
                    placeholder={maskedCredentials.twilio_auth_token || "Enter auth token"}
                    className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
                    type="password"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-slate-300 text-sm">Twilio Phone Number (E.164)</Label>
                  <Input
                    value={connectForm.twilio_phone_number}
                    onChange={(e) => setConnectForm((prev) => ({ ...prev, twilio_phone_number: e.target.value }))}
                    placeholder={maskedCredentials.twilio_phone_number || "+14155550123"}
                    className="mt-1 bg-slate-900 border-slate-700 text-slate-200"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConnect} disabled={savingConfig} className="bg-blue-500 hover:bg-blue-600 text-white" data-testid="call-connect-btn">
              {savingConfig ? "Saving..." : "Connect Call Agent"}
            </Button>
            <Button variant="outline" onClick={loadData} className="border-slate-700 text-slate-300">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>

          <div className="pt-2 border-t border-slate-700/60">
            <p className="text-xs text-slate-400 mb-2">Initiate test call</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                value={testCallTo}
                onChange={(e) => setTestCallTo(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="bg-slate-900 border-slate-700 text-slate-200"
              />
              <Input
                value={testCallName}
                onChange={(e) => setTestCallName(e.target.value)}
                placeholder="Lead name"
                className="bg-slate-900 border-slate-700 text-slate-200"
              />
              <Button onClick={handleTestCall} disabled={testingCall || !isConnected} className="bg-indigo-500 hover:bg-indigo-600 text-white">
                <PhoneCall className="h-4 w-4 mr-2" />
                {testingCall ? "Calling..." : "Start Test Call"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList className="bg-slate-800 border border-slate-700/50">
          <TabsTrigger value="logs" data-testid="tab-call-logs">Call Logs</TabsTrigger>
          <TabsTrigger value="script" data-testid="tab-call-script">Script Editor</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-call-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-slate-200 flex items-center justify-between">
                <span>Your call logs</span>
                <Badge className="bg-slate-700 text-slate-300 hover:opacity-100">{logs.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Lead</TableHead>
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Phone</TableHead>
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Duration</TableHead>
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Outcome</TableHead>
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-slate-500 text-xs uppercase tracking-wider">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log, i) => (
                    <TableRow key={i} className="border-slate-700/50" data-testid={`call-log-${i}`}>
                      <TableCell>
                        <p className="text-sm text-slate-200">{log.lead_name}</p>
                        <p className="text-xs text-slate-500">{log.company}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-400 font-mono tabular-nums">{log.phone}</TableCell>
                      <TableCell className="text-sm text-slate-300 font-mono tabular-nums">{log.duration && log.duration !== "—" ? log.duration : "—"}</TableCell>
                      <TableCell><Badge className={`${outcomeColors[log.outcome] || outcomeColors.no_answer} hover:opacity-100`}>{log.outcome?.replace(/_/g, " ") || "—"}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono tabular-nums">{log.timestamp ? new Date(log.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {log.has_recording ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-400 hover:text-slate-200" onClick={() => setRecording(log)}>
                              <Play className="h-3 w-3 mr-1" /> Play
                            </Button>
                          ) : (
                            <span className="text-[10px] text-slate-500 px-2 py-1">Recording not available</span>
                          )}
                          {log.has_transcript ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-400 hover:text-slate-200" onClick={() => setTranscript(log)}>
                              <FileText className="h-3 w-3 mr-1" /> Transcript
                            </Button>
                          ) : (
                            <span className="text-[10px] text-slate-500 px-2 py-1">Transcript not available</span>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-400 hover:text-red-400" onClick={() => deleteCallLog(log.log_id)} disabled={!log.log_id}>
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="script">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardHeader><CardTitle className="text-base text-slate-200">AI Call Script</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-300 text-sm">Opening</Label>
                <Textarea defaultValue="Hello, am I speaking with {lead_name}? This is your AI call assistant. I'm calling regarding your sales outreach strategy." className="mt-1 bg-slate-900 border-slate-700 text-slate-200 h-24" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Value Proposition</Label>
                <Textarea defaultValue="We automate WhatsApp, Email, and AI Voice outreach to increase your team’s conversion and speed-to-lead." className="mt-1 bg-slate-900 border-slate-700 text-slate-200 h-20" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Objection Handling</Label>
                <Textarea defaultValue={'If budget concern: "Totally fair. Let me share a short ROI view first."\nIf timing concern: "Understood. What time works better for a quick follow-up?"'} className="mt-1 bg-slate-900 border-slate-700 text-slate-200 h-28" />
              </div>
              <Button className="bg-blue-500 hover:bg-blue-600 text-white">Save Script</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardHeader><CardTitle className="text-base text-slate-200">Call Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 text-sm">Concurrent Calls Limit</Label>
                  <Input defaultValue="10" type="number" className="mt-1 bg-slate-900 border-slate-700 text-slate-200" />
                </div>
                <div>
                  <Label className="text-slate-300 text-sm">Call Hours</Label>
                  <Input defaultValue="9:00 AM - 8:00 PM" className="mt-1 bg-slate-900 border-slate-700 text-slate-200" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm text-slate-200">Record Calls</p><p className="text-xs text-slate-500">Store call recordings for review</p></div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm text-slate-200">Auto Transcribe</p><p className="text-xs text-slate-500">Generate transcripts for all calls</p></div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!transcript} onOpenChange={() => setTranscript(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Call Transcript &mdash; {transcript?.lead_name}</DialogTitle>
            <DialogDescription className="text-slate-400">{transcript?.phone} &bull; {transcript?.duration}</DialogDescription>
          </DialogHeader>
          <div className="bg-slate-900 rounded-lg p-4 max-h-[400px] overflow-y-auto space-y-2">
            {(transcript?.transcript || transcript?.conversation_text || "Transcript not available")
              .split("\n")
              .filter(Boolean)
              .map((line, i) => {
                const isAi = /^ai[:\s]/i.test(line);
                return (
                  <div key={i} className={`rounded-lg px-3 py-2 text-sm ${isAi ? "bg-blue-500/10 text-blue-200 ml-6" : "bg-slate-700/40 text-slate-200 mr-6"}`}>
                    {line}
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recording} onOpenChange={() => setRecording(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Call Recording &mdash; {recording?.lead_name}</DialogTitle>
            <DialogDescription className="text-slate-400">{recording?.phone} &bull; {recording?.duration}</DialogDescription>
          </DialogHeader>
          <div className="bg-slate-900 rounded-lg p-4">
            {recording?.recording_url ? (
              <audio controls className="w-full">
                <source src={recording.recording_url} />
              </audio>
            ) : (
              <p className="text-sm text-slate-400">Recording not available</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
