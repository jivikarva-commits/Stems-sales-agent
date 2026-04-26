import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import api from "../lib/api";

const TIERS = [
  { value: "250", label: "Tier 250" },
  { value: "1K", label: "Tier 1K" },
  { value: "10K", label: "Tier 10K" },
  { value: "100K", label: "Tier 100K" },
];

export default function AgentSetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    agent_name: "",
    business_name: "",
    business_description: "",
    messaging_tier: "1K",
  });
  const [phone, setPhone] = useState("");
  const [waState, setWaState] = useState({ connected: false, state: "disconnected", phone: "" });
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState("");

  const stepTitle = useMemo(() => {
    return [
      "What should your AI agent be called?",
      "What is your business name?",
      "What does your business do?",
      "What is your WhatsApp messaging limit?",
      "Connect your WhatsApp",
    ][step - 1];
  }, [step]);

  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      try {
        const [profileRes, waRes] = await Promise.all([
          api.get("/onboarding/profile"),
          api.get("/whatsapp/status").catch(() => ({ data: { connected: false, state: "disconnected" } })),
        ]);
        if (!mounted) return;
        const p = profileRes.data || {};
        if (p.onboarding_completed) {
          localStorage.setItem("onboarding_completed", "true");
          navigate("/dashboard", { replace: true });
          return;
        }
        localStorage.setItem("onboarding_completed", "false");
        setForm({
          agent_name: p.agent_name || "",
          business_name: p.business_name || "",
          business_description: p.business_description || "",
          messaging_tier: p.messaging_tier || "1K",
        });
        setWaState(waRes.data || { connected: false, state: "disconnected", phone: "" });
      } catch (e) {
        if (!mounted) return;
        setError("Unable to load onboarding profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadProfile();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  // Use a ref so the EventSource lifecycle is NOT tied to state changes.
  // This prevents the stream from being torn down every time connecting/qrCode changes.
  const esRef = useRef(null);

  const startQrStream = () => {
    // Close any existing stream first
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const sessionId = localStorage.getItem("session_id");
    const streamBase =
      process.env.REACT_APP_BACKEND_URL ||
      process.env.VITE_BACKEND_URL ||
      process.env.VITE_API_URL ||
      "https://stems-sales-agent.onrender.com";

    const toQrImageSrc = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.startsWith("data:image")) return raw;
      return `data:image/png;base64,${raw}`;
    };

    const es = new EventSource(
      `${streamBase}/api/whatsapp/qr-stream?session_id=${encodeURIComponent(sessionId || "")}`
    );
    esRef.current = es;

    const handlePayload = (payload) => {
      if (!payload || typeof payload !== "object") return;

      if (payload.event === "qr") {
        const normalizedQr = toQrImageSrc(payload.data);
        if (normalizedQr) {
          setQrCode(normalizedQr);
          setError("");
          setConnecting(false);
          setWaState((prev) => ({ ...prev, state: "qr_ready", connected: false }));
        }
        return;
      }

      if (payload.event === "status") {
        const stateValue = payload.data;
        const connected = stateValue === "connected";
        setWaState((prev) => ({ ...prev, state: stateValue, connected }));
        if (connected) {
          setConnecting(false);
          setQrCode("");
          // Close stream — no longer needed
          es.close();
          esRef.current = null;
        }
      }
    };

    es.onmessage = (evt) => {
      try { handlePayload(JSON.parse(evt.data)); } catch (_e) {}
    };
    es.addEventListener("qr", (evt) => {
      try {
        const p = JSON.parse(evt.data);
        handlePayload(p.event ? p : { event: "qr", data: p.data ?? evt.data });
      } catch (_e) { handlePayload({ event: "qr", data: evt.data }); }
    });
    es.addEventListener("status", (evt) => {
      try {
        const p = JSON.parse(evt.data);
        handlePayload(p.event ? p : { event: "status", data: p.data ?? evt.data });
      } catch (_e) { handlePayload({ event: "status", data: evt.data }); }
    });
    es.onerror = () => {
      // Don't kill the stream on transient errors — browser will auto-reconnect SSE.
      // Only mark error if we have no QR yet.
      setQrCode((current) => {
        if (!current) setConnecting(false);
        return current;
      });
    };
  };

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, []);

  const saveProfile = async (onboarding_completed) => {
    await api.post("/onboarding/profile", {
      ...form,
      onboarding_completed,
    });
  };

  const validateCurrentStep = () => {
    if (step === 1 && !form.agent_name.trim()) return "Agent name is required.";
    if (step === 2 && !form.business_name.trim()) return "Business name is required.";
    if (step === 3 && form.business_description.trim().length < 8) return "Please add a brief business description.";
    if (step === 4 && !form.messaging_tier) return "Please select a messaging tier.";
    return "";
  };

  const nextStep = async () => {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    if (step === 4) {
      setSaving(true);
      try {
        await saveProfile(false);
        setStep(5);
      } catch (_e) {
        setError("Failed to save onboarding details.");
      } finally {
        setSaving(false);
      }
      return;
    }
    setStep((s) => Math.min(5, s + 1));
  };

  const previousStep = () => {
    setError("");
    setStep((s) => Math.max(1, s - 1));
  };

  const saveWhatsAppSetup = async () => {
    if (!phone.trim()) {
      setError("WhatsApp business number is required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await api.post("/agents/setup", {
        type: "whatsapp",
        credentials: {
          provider: "baileys",
          business_number: phone.trim(),
          business_name: form.business_name.trim(),
          messaging_tier: form.messaging_tier,
        },
      });
    } catch (_e) {
      setError("Unable to save WhatsApp setup.");
    } finally {
      setSaving(false);
    }
  };

  const generateWhatsAppQr = async () => {
    if (!phone.trim()) {
      setError("WhatsApp business number is required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await api.post("/agents/setup", {
        type: "whatsapp",
        credentials: {
          provider: "baileys",
          business_number: phone.trim(),
          business_name: form.business_name.trim(),
          messaging_tier: form.messaging_tier,
        },
      });
      await api.post("/whatsapp/init-connection");
      setConnecting(true);
      setQrCode("");
      // Start the SSE stream AFTER init-connection succeeds
      startQrStream();
    } catch (_e) {
      setError("Unable to generate WhatsApp QR code.");
      setConnecting(false);
    } finally {
      setSaving(false);
    }
  };

  const refreshWhatsAppStatus = async () => {
    try {
      const res = await api.get("/whatsapp/status");
      const data = res.data || {};
      setWaState(data);
      if (data.connected) setConnecting(false);
    } catch (_e) {
      setError("Unable to fetch WhatsApp connection status.");
    }
  };

  const completeOnboarding = async () => {
    if (!waState.connected) {
      setError("Connect WhatsApp to complete onboarding.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveProfile(true);
      localStorage.setItem("onboarding_completed", "true");
      navigate("/dashboard", { replace: true });
    } catch (_e) {
      setError("Unable to complete onboarding.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-slate-300">Loading onboarding...</div>;
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen text-white">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-3xl font-heading font-bold">Set up your AI sales workspace</h1>
          <p className="text-sm text-slate-400 mt-1">Step {step} of 5</p>
        </div>

        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full ${s <= step ? "bg-blue-500" : "bg-slate-700/80"}`}
            />
          ))}
        </div>

        <Card className="glass-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-xl text-white">{stepTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && (
              <Input
                value={form.agent_name}
                onChange={(e) => setForm((prev) => ({ ...prev, agent_name: e.target.value }))}
                placeholder="e.g. Maya, Alex, SalesPilot"
                className="bg-white/5 border-white/15 text-white"
              />
            )}

            {step === 2 && (
              <Input
                value={form.business_name}
                onChange={(e) => setForm((prev) => ({ ...prev, business_name: e.target.value }))}
                placeholder="Your business name"
                className="bg-white/5 border-white/15 text-white"
              />
            )}

            {step === 3 && (
              <textarea
                rows={5}
                value={form.business_description}
                onChange={(e) => setForm((prev) => ({ ...prev, business_description: e.target.value }))}
                placeholder="Briefly describe what your business does."
                className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-blue-400"
              />
            )}

            {step === 4 && (
              <div className="grid grid-cols-2 gap-3">
                {TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    onClick={() => setForm((prev) => ({ ...prev, messaging_tier: tier.value }))}
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                      form.messaging_tier === tier.value
                        ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                        : "border-white/15 bg-white/5 text-slate-300 hover:border-white/25"
                    }`}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="WhatsApp business number (e.g. 919876543210)"
                  className="bg-white/5 border-white/15 text-white"
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveWhatsAppSetup} disabled={saving} className="bg-blue-500 hover:bg-blue-600 text-white">
                    Save WhatsApp Setup
                  </Button>
                  <Button onClick={generateWhatsAppQr} disabled={saving || connecting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {connecting ? "Generating QR..." : "Generate QR Code"}
                  </Button>
                  <Button onClick={refreshWhatsAppStatus} variant="outline" className="border-white/20 bg-white/5 text-slate-200 hover:bg-white/10">
                    Refresh Status
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Badge className={waState.connected ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-300"}>
                    {waState.connected ? "Connected" : (waState.state || "disconnected")}
                  </Badge>
                  {waState.connected && <span className="text-sm text-emerald-300">WhatsApp connected successfully.</span>}
                </div>

                {qrCode ? (
                  <div className="rounded-xl border border-white/15 bg-black/20 p-4">
                    <img src={qrCode} alt="WhatsApp QR code" className="w-56 h-56 mx-auto rounded-lg" />
                    <p className="text-xs text-slate-400 text-center mt-2">
                      Open WhatsApp &gt; Linked Devices &gt; Link a Device
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {error ? <p className="text-sm text-rose-300">{error}</p> : null}

            <div className="flex items-center justify-between pt-2">
              <Button onClick={previousStep} variant="outline" disabled={step === 1 || saving} className="border-white/20 bg-white/5 text-slate-200 hover:bg-white/10">
                Back
              </Button>
              {step < 5 ? (
                <Button onClick={nextStep} disabled={saving} className="bg-blue-500 hover:bg-blue-600 text-white">
                  {step === 4 ? "Save & Continue" : "Continue"}
                </Button>
              ) : (
                <Button onClick={completeOnboarding} disabled={saving || !waState.connected} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  Complete Setup
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
