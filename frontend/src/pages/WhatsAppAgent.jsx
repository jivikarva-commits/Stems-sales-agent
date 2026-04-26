import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { MessageCircle, CheckCircle, AlertCircle, Send, Trash2 } from "lucide-react";
import api from "../lib/api";

export default function WhatsAppAgent() {
  const [agent, setAgent] = useState(null);
  const [profileCtx, setProfileCtx] = useState({ business_name: "", messaging_tier: "" });
  const [waState, setWaState] = useState({ connected: false, state: "disconnected", phone: null });
  const [qrCode, setQrCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [setting, setSetting] = useState(false);
  const [outMsg, setOutMsg] = useState("");
  const [sending, setSending] = useState(false);

  // Per-user agent config
  const [agentCfg, setAgentCfg] = useState({
    agent_name: "", agent_description: "", reply_scope: "all", reply_keywords: [], configured: false,
  });
  const [keywordsInput, setKeywordsInput] = useState("");
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgSaved, setCfgSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/agents/whatsapp/status"),
      api.get("/whatsapp/conversations"),
      api.get("/whatsapp/status").catch(() => ({ data: { connected: false, state: "disconnected" } })),
      api.get("/auth/me").catch(() => ({ data: {} })),
      api.get("/whatsapp/agent-config").catch(() => ({ data: {} })),
    ])
      .then(([a, c, ws, me, cfg]) => {
        setAgent(a.data);
        setWaState(ws.data || { connected: false, state: "disconnected" });
        setProfileCtx({
          business_name: me?.data?.business_name || "",
          messaging_tier: me?.data?.messaging_tier || "",
        });
        const convList = Array.isArray(c.data) ? c.data : [];
        setConversations(convList);
        const cfgData = cfg?.data || {};
        setAgentCfg({
          agent_name: cfgData.agent_name || me?.data?.agent_name || "",
          agent_description: cfgData.agent_description || "",
          reply_scope: cfgData.reply_scope || "all",
          reply_keywords: cfgData.reply_keywords || [],
          configured: !!cfgData.configured,
        });
        setKeywordsInput((cfgData.reply_keywords || []).join(", "));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const saveAgentCfg = async () => {
    if (!agentCfg.agent_name.trim()) {
      alert("Agent name is required.");
      return;
    }
    if (!agentCfg.agent_description.trim() || agentCfg.agent_description.trim().length < 20) {
      alert("Please describe your agent in at least 20 characters — your own words.");
      return;
    }
    setSavingCfg(true);
    setCfgSaved(false);
    try {
      const keywords = keywordsInput
        .split(/[,\n]/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      await api.post("/whatsapp/agent-config", {
        agent_name: agentCfg.agent_name.trim(),
        agent_description: agentCfg.agent_description.trim(),
        reply_scope: agentCfg.reply_scope === "keywords" ? "keywords" : "all",
        reply_keywords: keywords,
      });
      setAgentCfg((prev) => ({ ...prev, reply_keywords: keywords, configured: true }));
      setCfgSaved(true);
      setTimeout(() => setCfgSaved(false), 3000);
    } catch (e) {
      console.error(e);
      alert("Failed to save agent config: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSavingCfg(false);
    }
  };

  useEffect(() => {
    if (!connecting && !qrCode) return undefined;
    const sessionId = localStorage.getItem("session_id");
    const streamBase = process.env.REACT_APP_BACKEND_URL || process.env.VITE_BACKEND_URL || process.env.VITE_API_URL || "https://stems-sales-agent.onrender.com";
    const es = new EventSource(`${streamBase}/api/whatsapp/qr-stream?session_id=${encodeURIComponent(sessionId || "")}`);
    es.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload.event === "qr") setQrCode(payload.data || "");
        if (payload.event === "status") {
          setWaState((prev) => ({ ...prev, state: payload.data, connected: payload.data === "connected" }));
          if (payload.data === "connected") {
            setConnecting(false);
            setQrCode("");
          }
          if (payload.data === "error") {
            setConnecting(false);
          }
        }
      } catch (_) {}
    };
    es.onerror = () => {
      setConnecting(false);
      setWaState((prev) => ({ ...prev, state: "error", connected: false }));
      es.close();
    };
    return () => es.close();
  }, [connecting, qrCode]);

  const handleSetup = async () => {
    setSetting(true);
    try {
      const res = await api.post("/agents/setup", {
        type: "whatsapp",
        credentials: {
          business_number: phone,
          provider: "baileys",
          business_name: profileCtx.business_name || "Business",
          messaging_tier: profileCtx.messaging_tier || "",
        },
      });
      setAgent(res.data);
    } catch (e) { console.error(e); }
    setSetting(false);
  };

  const initQrConnection = async () => {
    setConnecting(true);
    setQrCode("");
    try {
      await api.post("/whatsapp/init-connection");
      const s = await api.get("/whatsapp/status");
      setWaState(s.data || { connected: false, state: "connecting" });
      const a = await api.get("/agents/whatsapp/status");
      setAgent(a.data);
    } catch (e) {
      console.error(e);
      setConnecting(false);
    }
  };

  const logoutWhatsapp = async () => {
    try {
      await api.post("/whatsapp/logout");
      setWaState({ connected: false, state: "disconnected", phone: null });
      setQrCode("");
      const a = await api.get("/agents/whatsapp/status");
      setAgent(a.data);
    } catch (e) { console.error(e); }
  };

  const handleToggle = async () => {
    try {
      const res = await api.put("/agents/whatsapp/toggle");
      setAgent(res.data);
    } catch (e) { console.error(e); }
  };

  const openThread = async (conv) => {
    setSelected(conv);
    setThread(null);
    try {
      const r = await api.get(`/whatsapp/conversations/${encodeURIComponent(conv.lead_id)}`);
      // api.js returns r.data (axios response), so use r.data directly
      setThread(r.data);
    } catch (e) { console.error(e); }
  };

  const sendMessage = async () => {
    if (!selected || !outMsg.trim()) return;
    setSending(true);
    try {
      await api.post("/whatsapp/send", { to: selected.lead_id, message: outMsg });
      setOutMsg("");
      await openThread(selected);
    } catch (e) { console.error(e); }
    setSending(false);
  };

  const deleteConversation = async (conv) => {
    if (!conv?.lead_id) return;
    const ok = window.confirm(`Delete conversation with ${conv.lead_name || conv.lead_id}?`);
    if (!ok) return;
    try {
      await api.delete(`/whatsapp/conversations/${encodeURIComponent(conv.lead_id)}`);
      setConversations((prev) => prev.filter((c) => c.lead_id !== conv.lead_id));
      if (selected?.lead_id === conv.lead_id) {
        setSelected(null);
        setThread(null);
      }
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="p-8 text-slate-400">Loading WhatsApp Agent...</div>;

  return (
    <div className="p-6 lg:p-8" data-testid="whatsapp-agent-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-slate-50 tracking-tight">WhatsApp Agent</h1>
          <p className="text-sm text-slate-400 mt-1">AI-powered WhatsApp sales conversations</p>
        </div>
        {agent?.status === "active" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Agent Active</span>
            <Switch checked={agent?.status === "active"} onCheckedChange={handleToggle} />
          </div>
        )}
      </div>

      {agent?.status !== "active" ? (
        <Card className="bg-slate-800 border-amber-500/20 mb-6">
          <CardContent className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />
              <div><p className="text-sm font-medium text-slate-200">Setup Required</p>
                <p className="text-xs text-slate-400 mt-0.5">Connect your WhatsApp with QR scan (Baileys)</p>
              </div>
            </div>
            <div className="space-y-3 max-w-md">
              <Input value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="WhatsApp Business Number (e.g. 15559384796)"
                className="bg-slate-900 border-slate-700 text-slate-200" />
              <Button onClick={handleSetup} disabled={!phone || setting} className="bg-blue-500 hover:bg-blue-600 text-white">
                {setting ? "Connecting..." : "Connect WhatsApp"}
              </Button>
              <Button onClick={initQrConnection} disabled={connecting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {connecting ? "Generating QR..." : "Generate QR"}
              </Button>
              {qrCode ? (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                  <img src={qrCode} alt="WhatsApp QR" className="w-56 h-56 mx-auto rounded" />
                  <p className="text-xs text-slate-400 mt-2 text-center">Open WhatsApp → Linked Devices → Link a Device</p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-emerald-500/5 border-emerald-500/20 mb-6">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-400">Connected via WhatsApp QR</p>
              <p className="text-xs text-slate-400">
                {waState?.phone || agent?.credentials?.business_number || "Phone unavailable"} — {agent?.credentials?.business_name || profileCtx.business_name || "Business"}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto text-slate-300 hover:text-red-400" onClick={logoutWhatsapp}>
              Logout Device
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="conversations" className="space-y-4">
        <TabsList className="bg-slate-800 border border-slate-700/50">
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="conversations">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-slate-800 border-slate-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Active Threads ({conversations.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[500px] overflow-y-auto">
                {conversations.map((c, i) => (
                  <div key={c.lead_id || i}
                    className={`flex items-start gap-3 p-3 border-b border-slate-700/30 last:border-0 hover:bg-slate-700/20 transition-colors ${selected?.lead_id === c.lead_id ? "bg-slate-700/30" : ""}`}>
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-emerald-400">{c.lead_name?.[0] || "?"}</span>
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openThread(c)}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-200 truncate">{c.lead_name}</p>
                        <span className="text-[10px] text-slate-500 font-mono ml-2 shrink-0">
                          {c.timestamp ? new Date(c.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{c.last_message}</p>
                      {c.lead_score > 60 && <Badge className="bg-emerald-500/10 text-emerald-400 text-[9px] mt-1">Hot Lead 🔥</Badge>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-slate-400 hover:text-red-400 shrink-0"
                      onClick={() => deleteConversation(c)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {conversations.length === 0 && (
                  <p className="text-sm text-slate-500 py-8 text-center">No conversations yet.<br />Incoming WhatsApp messages will appear here.</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-700/50">
              {thread ? (
                <>
                  <CardHeader className="pb-2 border-b border-slate-700/50">
                    <CardTitle className="text-sm text-slate-200">{thread.lead?.name || selected?.lead_name}</CardTitle>
                    <p className="text-xs text-slate-500">{selected?.lead_id}</p>
                  </CardHeader>
                  <CardContent className="p-3 flex flex-col h-[400px]">
                    <div className="flex-1 overflow-y-auto space-y-2 mb-3">
                      {(thread.messages || []).map((m, i) => (
                        <div key={i} className={`flex ${m.role === "assistant" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.role === "assistant" ? "bg-emerald-500/20 text-emerald-100" : "bg-slate-700 text-slate-300"}`}>
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input value={outMsg} onChange={e => setOutMsg(e.target.value)}
                        placeholder="Type a message..."
                        className="bg-slate-900 border-slate-700 text-slate-200 text-xs"
                        onKeyDown={e => e.key === "Enter" && sendMessage()} />
                      <Button size="sm" onClick={sendMessage} disabled={sending || !outMsg.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </>
              ) : (
                <CardContent className="p-8 text-center">
                  <MessageCircle className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Select a conversation to view messages</p>
                </CardContent>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="bg-slate-800 border-slate-700/50">
            <CardHeader>
              <CardTitle className="text-base text-slate-200">Your AI Agent</CardTitle>
              <p className="text-xs text-slate-400">
                Define your agent in your own words. The agent will reply to WhatsApp messages using only what you write here.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {!agentCfg.configured && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
                  Setup required — please describe your agent below before it starts replying.
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 uppercase tracking-wider">Agent Name</label>
                <Input
                  value={agentCfg.agent_name}
                  onChange={(e) => setAgentCfg((p) => ({ ...p, agent_name: e.target.value }))}
                  placeholder="e.g. Maya, Arjun, Sam"
                  className="bg-slate-900 border-slate-700 text-slate-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 uppercase tracking-wider">
                  Agent Description (your own words — what should the agent do, who do you sell to, what's your tone?)
                </label>
                <textarea
                  rows={6}
                  value={agentCfg.agent_description}
                  onChange={(e) => setAgentCfg((p) => ({ ...p, agent_description: e.target.value }))}
                  placeholder="Example: I run a real-estate agency in Mumbai. You should help leads find apartments by asking about their budget, location preference, and family size. Be friendly, use Hinglish, and never push them. End conversations by suggesting a site visit."
                  className="w-full rounded-md border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-400"
                />
                <p className="text-[10px] text-slate-500">
                  Minimum 20 characters. The agent only knows what you write here.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 uppercase tracking-wider">Reply Scope</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAgentCfg((p) => ({ ...p, reply_scope: "all" }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs text-left transition ${
                      agentCfg.reply_scope === "all"
                        ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <div className="font-medium">Reply to all messages</div>
                    <div className="text-[10px] mt-0.5 opacity-75">Agent responds to every incoming message</div>
                  </button>
                  <button
                    onClick={() => setAgentCfg((p) => ({ ...p, reply_scope: "keywords" }))}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs text-left transition ${
                      agentCfg.reply_scope === "keywords"
                        ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <div className="font-medium">Reply to specific keywords only</div>
                    <div className="text-[10px] mt-0.5 opacity-75">Define keywords below</div>
                  </button>
                </div>
              </div>

              {agentCfg.reply_scope === "keywords" && (
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 uppercase tracking-wider">
                    Keywords (comma-separated — agent only replies if message contains one of these)
                  </label>
                  <Input
                    value={keywordsInput}
                    onChange={(e) => setKeywordsInput(e.target.value)}
                    placeholder="price, demo, book, available, info"
                    className="bg-slate-900 border-slate-700 text-slate-200"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={saveAgentCfg}
                  disabled={savingCfg}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {savingCfg ? "Saving..." : "Save Agent Config"}
                </Button>
                {cfgSaved && <span className="text-sm text-emerald-400">Saved successfully</span>}
              </div>

              <div className="border-t border-slate-700/50 pt-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Provider Info</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Provider</p>
                    <p className="text-sm text-slate-200 mt-0.5">Baileys (WhatsApp Web)</p>
                  </div>
                  <div className="bg-slate-900 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">AI Model</p>
                    <p className="text-sm text-slate-200 mt-0.5">Claude Sonnet 4</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={false}>
        <DialogContent className="bg-slate-800 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Thread</DialogTitle>
            <DialogDescription className="text-slate-400">Conversation history</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
