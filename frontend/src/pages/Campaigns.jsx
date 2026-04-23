import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { Megaphone, Plus, Upload, Play, Send, Users, MessageCircle, Mail, Phone, Bot, Trash2 } from "lucide-react";
import api from "../lib/api";

const STATUS_COLORS = {
  active:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  draft:     "bg-slate-700/50 text-slate-400 border-slate-600/30",
  paused:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default function Campaigns() {
  const [campaigns, setCampaigns]           = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showCreate, setShowCreate]         = useState(false);
  const [showDetail, setShowDetail]         = useState(null);
  const [detail, setDetail]                 = useState(null);
  const [campName, setCampName]             = useState("");
  const [selectedAgents, setSelectedAgents] = useState(["whatsapp","email"]);
  const [csvFile, setCsvFile]               = useState(null);
  const [creating, setCreating]             = useState(false);
  const [launchingId, setLaunchingId]       = useState(null);
  const [launchError, setLaunchError]       = useState("");
  const fileRef = useRef();
  const [chatMessages, setChatMessages] = useState([
    { role:"assistant", content:"Namaste! Main Arjun hoon — aapka AI campaign manager. Campaign banani hai, launch karni hai, ya kuch aur? Bata do!" }
  ]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const load = () => {
    return api.get("/campaigns")
      .then(r => setCampaigns(Array.isArray(r.data) ? r.data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatMessages]);

  const toggleAgent = t => setSelectedAgents(p => p.includes(t) ? p.filter(a=>a!==t) : [...p,t]);

  const handleCreate = async () => {
    if (!campName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post("/campaigns", { name: campName, agents: selectedAgents });
      const cid = res.data.id;
      if (csvFile) {
        const form = new FormData();
        form.append("file", csvFile);
        await api.post(`/campaigns/${cid}/upload-csv`, form, { headers:{"Content-Type":"multipart/form-data"} });
      }
      setShowCreate(false); setCampName(""); setCsvFile(null); setSelectedAgents(["whatsapp","email"]);
      load();
    } catch(e) { console.error("Create error:", e); }
    setCreating(false);
  };

  const viewDetail = async id => {
    setLaunchError("");
    setShowDetail(id);
    try { const r = await api.get(`/campaigns/${id}`); setDetail(r.data); } catch(e){ console.error(e); }
  };

  const launchCampaign = async id => {
    setLaunchError("");
    setLaunchingId(id);
    try {
      await api.post(`/campaigns/${id}/launch`);
      await load();
      if (detail) await viewDetail(id);
      return { ok: true };
    } catch(e){
      const msg = e?.response?.data?.detail || e?.message || "Campaign launch failed";
      setLaunchError(msg);
      console.error(e);
      return { ok: false, error: msg };
    } finally {
      setLaunchingId(null);
    }
  };

  const deleteCampaign = async id => {
    try {
      await api.delete(`/campaigns/${id}`);
      setShowDetail(null);
      setDetail(null);
      load();
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role:"user", content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const r = await api.post("/campaigns/chat", { message: chatInput, history: chatMessages.slice(-8) });
      const { reply, action } = r.data;
      setChatMessages(prev => [...prev, { role:"assistant", content: reply || "..." }]);

      if (!action) {
        // no-op
      } else if (action.type === "open_create_modal") {
        setTimeout(() => setShowCreate(true), 400);
      } else if (action.type === "launch_campaign" && action.name) {
        const camp = campaigns.find(c => c.name.toLowerCase().includes(action.name.toLowerCase()) && c.status === "draft");
        if (camp) {
          const launched = await launchCampaign(camp.id);
          if (launched?.ok) {
            setChatMessages(prev => [...prev, { role:"assistant", content:`Campaign "${camp.name}" launch kar diya!` }]);
          } else {
            setChatMessages(prev => [...prev, { role:"assistant", content:`Campaign launch failed: ${launched?.error || "unknown error"}` }]);
          }
        } else {
          setChatMessages(prev => [...prev, { role:"assistant", content:"Draft campaign nahi mili is naam se." }]);
        }
      } else if ((action.type === "send_template" || action.type === "send_whatsapp") && action.to) {
        try {
          const sendRes = await api.post("/whatsapp/send/template", {
            to: action.to,
            template: action.template || "stems_business_intro",
            variables: action.variables || [],
          });
          const deliveryState = sendRes?.data?.delivery_status === "pending" ? "request accepted" : "sent";
          setChatMessages(prev => [...prev, { role:"assistant", content:`Template ${deliveryState} +${action.to}. Final status webhook pe aayega.` }]);
        } catch(err) {
          setChatMessages(prev => [...prev, { role:"assistant", content:"Send failed: " + (err?.response?.data?.detail || err?.message) }]);
        }
      } else if (action.type === "make_call" && action.phone) {
        try {
          await api.post("/calls/make", { phone: action.phone, name: action.name || "Customer" });
          setChatMessages(prev => [...prev, { role:"assistant", content:"Call initiate kar diya +" + action.phone + "!" }]);
        } catch(err) {
          setChatMessages(prev => [...prev, { role:"assistant", content:"Call failed: " + (err?.response?.data?.detail || err?.message) }]);
        }
      } else if (action.type === "send_email" && action.to) {
        try {
          await api.post("/email/send", { to: action.to, name: action.name || "Customer", business: action.business || "" });
          setChatMessages(prev => [...prev, { role:"assistant", content:"Email bhej diya " + action.to + "!" }]);
        } catch(err) {
          setChatMessages(prev => [...prev, { role:"assistant", content:"Email failed: " + (err?.response?.data?.detail || err?.message) }]);
        }
      }
    } catch(e) {
      console.error("Chat error:", e);
      setChatMessages(prev => [...prev, { role:"assistant", content:"Error aa gayi. Backend check karo." }]);
    }
    setChatLoading(false);
  };

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>;

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Campaigns</h1>
          <p className="text-sm text-slate-400 mt-1">Manage your outreach campaigns</p>
        </div>
        <Button className="bg-blue-500 hover:bg-blue-600 text-white" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Campaign
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaign Cards */}
        <div className="lg:col-span-1">
          {campaigns.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700/50">
              <CardContent className="p-12 text-center">
                <Megaphone className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No campaigns yet.</p>
                <p className="text-slate-500 text-xs mt-1">Create one or ask the AI assistant!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {campaigns.map(c => {
                const total    = c.stats?.sent || 1;
                const progress = c.status === "completed" ? 100 : c.status === "draft" ? 0
                               : Math.round(((c.stats?.replied||0)/total)*100);
                return (
                  <Card key={c.id} className="bg-slate-800 border-slate-700/50 hover:border-slate-600 cursor-pointer"
                    onClick={() => viewDetail(c.id)}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-slate-700/40"><Megaphone className="h-4 w-4 text-blue-400" /></div>
                          <div>
                            <p className="text-sm font-medium text-slate-200">{c.name}</p>
                            <p className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</p>
                          </div>
                        </div>
                        <Badge className={STATUS_COLORS[c.status] || STATUS_COLORS.draft}>{c.status}</Badge>
                      </div>
                      <Progress value={progress} className="h-1.5 mb-3 bg-slate-700" />
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-lg font-mono font-semibold text-slate-100">{c.stats?.sent||0}</p><p className="text-[10px] text-slate-500 uppercase">Sent</p></div>
                        <div><p className="text-lg font-mono font-semibold text-slate-100">{c.stats?.replied||0}</p><p className="text-[10px] text-slate-500 uppercase">Replied</p></div>
                        <div><p className="text-lg font-mono font-semibold text-emerald-400">{c.stats?.converted||0}</p><p className="text-[10px] text-slate-500 uppercase">Converted</p></div>
                      </div>
                      <div className="flex gap-1.5 mt-3">
                        {c.agents?.includes("whatsapp") && <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />}
                        {c.agents?.includes("email")    && <Mail className="h-3.5 w-3.5 text-blue-400" />}
                        {c.agents?.includes("call")     && <Phone className="h-3.5 w-3.5 text-amber-400" />}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Chat */}
        <div className="lg:col-span-1">
          <Card className="bg-slate-800 border-slate-700/50 flex flex-col" style={{minHeight:"500px"}}>
            <CardHeader className="pb-3 border-b border-slate-700/50 flex-shrink-0">
              <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/10 rounded-lg"><Bot className="h-4 w-4 text-blue-400" /></div>
                AI Campaign Assistant
                <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
                {chatMessages.map((m,i) => (
                  <div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      m.role==="user"
                        ? "bg-blue-500/20 text-blue-100 border border-blue-500/20"
                        : "bg-slate-700/60 text-slate-200 border border-slate-600/30"
                    }`}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-700/60 border border-slate-600/30 rounded-xl px-4 py-2">
                      <div className="flex gap-1">
                        {[0,150,300].map(d => <div key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:`${d}ms`}}></div>)}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {["New campaign banao","Stats batao","Draft launch karo"].map(s => (
                  <button key={s} onClick={() => setChatInput(s)}
                    className="text-[10px] text-slate-400 bg-slate-700/40 border border-slate-600/40 hover:border-slate-500 px-2 py-1 rounded-full transition-colors">
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendChat()}
                  placeholder="Kuch pucho ya instruction do..."
                  className="bg-slate-900 border-slate-700 text-slate-200 text-xs h-9" disabled={chatLoading} />
                <Button size="sm" onClick={sendChat} disabled={!chatInput.trim()||chatLoading}
                  className="bg-blue-500 hover:bg-blue-600 text-white h-9 px-3 flex-shrink-0">
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Create Campaign</DialogTitle>
            <DialogDescription className="text-slate-400">Set up a new outreach campaign</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-slate-300 text-sm">Campaign Name</Label>
              <Input value={campName} onChange={e=>setCampName(e.target.value)} placeholder="e.g. Q2 Outreach"
                className="mt-1.5 bg-slate-900 border-slate-700 text-slate-200" />
            </div>
            <div>
              <Label className="text-slate-300 text-sm mb-2 block">Select Agents</Label>
              <div className="space-y-2">
                {[["whatsapp","WhatsApp Agent",MessageCircle],["email","Email Agent",Mail],["call","Call Agent",Phone]].map(([t,l,I]) => (
                  <label key={t} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer hover:border-slate-600 transition-colors">
                    <Checkbox checked={selectedAgents.includes(t)} onCheckedChange={()=>toggleAgent(t)} />
                    <I className="h-4 w-4 text-slate-400" /><span className="text-sm text-slate-300">{l}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Upload CSV (optional)</Label>
              <div className="mt-1.5 border border-dashed border-slate-700 rounded-lg p-4 text-center cursor-pointer hover:border-slate-500" onClick={()=>fileRef.current?.click()}>
                <Upload className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                <p className="text-xs text-slate-500">{csvFile?csvFile.name:"Click to upload (Name, Phone Number, Email)"}</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e=>setCsvFile(e.target.files[0])} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setShowCreate(false)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button onClick={handleCreate} disabled={!campName.trim()||creating} className="bg-blue-500 hover:bg-blue-600 text-white">
              {creating?"Creating...":"Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={!!showDetail} onOpenChange={()=>{setShowDetail(null);setDetail(null);setLaunchError("");}}>
        <DialogContent className="bg-slate-800 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-100">{detail?.name||"Campaign Details"}</DialogTitle>
            <DialogDescription className="text-slate-400">{detail?.status==="draft"?"Not launched yet":`Status: ${detail?.status}`}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                {[["Sent",detail.stats?.sent],["Opened",detail.stats?.opened],["Replied",detail.stats?.replied],["Called",detail.stats?.called],["Failed",detail.stats?.failed],["Converted",detail.stats?.converted]].map(([l,v])=>(
                  <div key={l} className="bg-slate-900 rounded-lg p-2">
                    <p className="text-lg font-mono font-semibold text-slate-100">{v||0}</p>
                    <p className="text-[10px] text-slate-500 uppercase">{l}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-300">{detail.leads_count||detail.leads?.length||0} leads</span>
              </div>
              {detail.leads?.slice(0,5).map(l=>(
                <div key={l.id} className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
                  <div><p className="text-sm text-slate-200">{l.name||l.phone||l.email}</p><p className="text-xs text-slate-500">{l.email}</p></div>
                  <Badge className={l.status==="converted"?"bg-emerald-500/10 text-emerald-400":"bg-slate-700/50 text-slate-400"} variant="outline">{l.status}</Badge>
                </div>
              ))}
              {launchError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {launchError}
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {detail?.status==="draft" && (
              <Button onClick={()=>launchCampaign(detail.id)} disabled={launchingId === detail.id} className="bg-blue-500 hover:bg-blue-600 text-white">
                <Play className="h-4 w-4 mr-2" /> {launchingId === detail.id ? "Launching..." : "Launch Campaign"}
              </Button>
            )}
            {(detail?.status==="completed" || detail?.status==="active") && (
              <Button
                onClick={()=>deleteCampaign(detail.id)}
                variant="destructive"
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete Campaign
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
