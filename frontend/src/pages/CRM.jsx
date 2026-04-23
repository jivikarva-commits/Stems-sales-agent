import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { Search, Filter, MessageCircle, Mail, Phone, Calendar, Trash2, GripVertical } from "lucide-react";
import api from "../lib/api";

const statusMap = {
  new: { label: "New", color: "bg-slate-700/60 text-slate-300" },
  contacted: { label: "Contacted", color: "bg-blue-500/15 text-blue-200" },
  interested: { label: "Interested", color: "bg-violet-500/15 text-violet-200" },
  qualified: { label: "Qualified", color: "bg-indigo-500/15 text-indigo-200" },
  hot: { label: "Hot", color: "bg-emerald-500/15 text-emerald-200" },
  meeting_scheduled: { label: "Demo Scheduled", color: "bg-amber-500/15 text-amber-200" },
  converted: { label: "Converted", color: "bg-emerald-500/15 text-emerald-200" },
  rejected: { label: "Rejected", color: "bg-red-500/15 text-red-200" },
  lost: { label: "Lost", color: "bg-red-500/15 text-red-200" },
};

const lanes = [
  { id: "incoming", title: "Incoming", statuses: ["new", "contacted"], color: "#3B82F6", targetStatus: "contacted" },
  { id: "qualified", title: "Qualified", statuses: ["interested", "qualified", "hot"], color: "#10B981", targetStatus: "interested" },
  { id: "demo", title: "Demo Scheduled", statuses: ["meeting_scheduled", "converted"], color: "#F59E0B", targetStatus: "meeting_scheduled" },
];

function sourceBadge(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("whatsapp")) return { label: "WhatsApp", cls: "bg-emerald-500/15 text-emerald-200" };
  if (s.includes("email") || s.includes("gmail")) return { label: "Gmail", cls: "bg-blue-500/15 text-blue-200" };
  if (s.includes("call")) return { label: "Phone", cls: "bg-amber-500/15 text-amber-200" };
  if (s.includes("csv")) return { label: "Web Form", cls: "bg-violet-500/15 text-violet-200" };
  return { label: "Lead", cls: "bg-slate-700/60 text-slate-300" };
}

function LeadDetail({ lead, onStatusChange, onDelete }) {
  const [timeline, setTimeline] = useState([]);
  const [notes, setNotes] = useState(lead?.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead) return;
    api.get(`/leads/${lead.id}/timeline`).then((r) => setTimeline(r.data)).catch(() => {});
    setNotes(lead.notes || "");
  }, [lead]);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api.put(`/leads/${lead.id}/notes`, { notes });
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  if (!lead) return null;
  const source = sourceBadge(lead.source);
  const icons = { whatsapp: MessageCircle, email: Mail, call: Phone };

  return (
    <DialogContent className="glass-card border-white/15 max-w-lg max-h-[85vh] overflow-y-auto text-white">
      <DialogHeader>
        <DialogTitle className="text-white">{lead.name || "Unknown Lead"}</DialogTitle>
        <DialogDescription className="text-slate-400">
          {lead.company || "Unknown Company"} • {lead.email || "No email"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Phone</p>
            <p className="text-sm text-slate-200 font-mono tabular-nums mt-0.5">{lead.phone || "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Source</p>
            <Badge className={`${source.cls} mt-1 hover:opacity-100`}>{source.label}</Badge>
          </div>
        </div>

        <div>
          <Label className="text-slate-400 text-xs uppercase tracking-wider">Status</Label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(statusMap).map(([key, { label, color }]) => (
              <Button
                key={key}
                size="sm"
                variant="ghost"
                className={`h-7 text-xs ${
                  lead.status === key ? `${color} font-semibold` : "text-slate-500 hover:text-slate-200"
                }`}
                onClick={() => onStatusChange(lead.id, key)}
                data-testid={`status-btn-${key}`}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-slate-400 text-xs uppercase tracking-wider">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this lead..."
            className="mt-1.5 border-white/15 bg-black/20 text-slate-200 h-20"
            data-testid="lead-notes-input"
          />
          <Button size="sm" onClick={saveNotes} disabled={saving} className="mt-2 bg-blue-500 hover:bg-blue-600 text-white text-xs" data-testid="save-notes-btn">
            {saving ? "Saving..." : "Save Notes"}
          </Button>
        </div>

        <div>
          <Label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">Timeline</Label>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No interactions yet</p>
          ) : (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {timeline.map((t, i) => {
                const Icon = icons[t.agent_type] || MessageCircle;
                return (
                  <div key={i} className="flex gap-3 py-2 border-b border-white/10 last:border-0">
                    <div className="p-1.5 rounded-md bg-white/10 h-fit">
                      <Icon className="h-3 w-3 text-slate-200" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300">{t.content}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 font-mono tabular-nums">
                        {new Date(t.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        <span className="ml-1.5">• {t.status}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
          onClick={() => onDelete(lead)}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete Lead
        </Button>
        <Button variant="outline" className="border-white/20 bg-white/5 text-slate-200 hover:bg-white/10" data-testid="schedule-meeting-btn">
          <Calendar className="h-4 w-4 mr-2" /> Schedule Meeting
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function CRM() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [dragLeadId, setDragLeadId] = useState(null);
  const [dragLane, setDragLane] = useState("");

  const load = (s = search, f = statusFilter) => {
    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (f && f !== "all") params.set("status", f);
    params.set("limit", "50");
    api.get(`/leads?${params}`)
      .then((r) => {
        setLeads(r.data.leads);
        setTotal(r.data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (val) => { setSearch(val); load(val, statusFilter); };
  const handleFilter = (val) => { setStatusFilter(val); load(search, val); };

  const handleStatusChange = async (id, status) => {
    try {
      const res = await api.put(`/leads/${id}/status`, { status });
      setLeads((prev) => prev.map((l) => (l.id === id ? res.data : l)));
      if (selected?.id === id) setSelected(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteLead = async (lead) => {
    if (!lead?.id) return;
    const ok = window.confirm(`Delete lead "${lead.name || lead.id}" and related conversation data?`);
    if (!ok) return;
    try {
      await api.delete(`/leads/${encodeURIComponent(lead.id)}`);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      if (selected?.id === lead.id) setSelected(null);
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (e) {
      console.error(e);
    }
  };

  const groupedLeads = useMemo(() => {
    const data = { incoming: [], qualified: [], demo: [] };
    leads.forEach((lead) => {
      if (lanes[0].statuses.includes(lead.status)) data.incoming.push(lead);
      else if (lanes[1].statuses.includes(lead.status)) data.qualified.push(lead);
      else if (lanes[2].statuses.includes(lead.status)) data.demo.push(lead);
      else data.incoming.push(lead);
    });
    return data;
  }, [leads]);

  const dropLead = async (lane) => {
    const lead = leads.find((l) => l.id === dragLeadId);
    setDragLane("");
    if (!lead) return;
    if (lane.statuses.includes(lead.status)) return;
    await handleStatusChange(lead.id, lane.targetStatus);
  };

  if (loading) return <div className="p-8 text-slate-300">Loading CRM...</div>;

  return (
    <div className="p-6 lg:p-8 text-white" data-testid="crm-page">
      <div className="mb-6">
        <h1 className="text-3xl font-heading font-bold">Modern Lead Board</h1>
        <p className="text-sm font-medium text-slate-400 mt-1">{total} leads across all campaigns</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search leads by name, email, or company..."
            className="pl-9 border-white/15 bg-white/[0.04] text-slate-100"
            data-testid="crm-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleFilter}>
          <SelectTrigger className="w-[190px] border-white/15 bg-white/[0.04] text-slate-200" data-testid="crm-status-filter">
            <Filter className="h-3.5 w-3.5 mr-2 text-slate-500" />
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent className="glass-card border-white/15 text-slate-200">
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(statusMap).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {lanes.map((lane) => (
          <Card
            key={lane.id}
            className={`glass-card rounded-2xl min-h-[560px] transition-all duration-200 ${
              dragLane === lane.id ? "border-blue-400/45 shadow-[0_0_28px_rgba(59,130,246,0.2)]" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragLane(lane.id);
            }}
            onDragLeave={() => setDragLane("")}
            onDrop={(e) => {
              e.preventDefault();
              dropLead(lane);
              setDragLeadId(null);
            }}
          >
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold">{lane.title}</p>
                  <p className="text-xs text-slate-400">{groupedLeads[lane.id].length} leads</p>
                </div>
                <div className="h-1.5 w-20 rounded-full" style={{ backgroundColor: `${lane.color}66` }} />
              </div>

              <div className="space-y-3">
                {groupedLeads[lane.id].map((lead) => {
                  const source = sourceBadge(lead.source);
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDragLeadId(lead.id)}
                      onDragEnd={() => {
                        setDragLeadId(null);
                        setDragLane("");
                      }}
                      onClick={() => setSelected(lead)}
                      className={`glass-card glass-hover rounded-xl p-3 cursor-pointer transition-all ${
                        dragLeadId === lead.id ? "opacity-70 scale-[0.99]" : ""
                      }`}
                      data-testid={`lead-row-${String(lead.name || lead.email || lead.phone || lead.id || "unknown").replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-xs font-semibold text-blue-200">
                            {(lead.name || lead.email || "L").slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm text-white font-medium truncate">{lead.name || "Unknown Lead"}</p>
                            <p className="text-[11px] text-slate-400 truncate">{lead.company || lead.email || "No details"}</p>
                          </div>
                        </div>
                        <GripVertical className="h-4 w-4 text-slate-500 shrink-0" />
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <Badge className={`${statusMap[lead.status]?.color || "bg-slate-700/60 text-slate-300"} hover:opacity-100`}>
                          {statusMap[lead.status]?.label || String(lead.status || "new")}
                        </Badge>
                        <Badge className={`${source.cls} hover:opacity-100`}>
                          {source.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {groupedLeads[lane.id].length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8 border border-dashed border-white/10 rounded-xl">
                    Drop leads here
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        {selected ? (
          <LeadDetail
            lead={selected}
            onStatusChange={handleStatusChange}
            onDelete={handleDeleteLead}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
