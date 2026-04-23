import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();
  const goToDashboard = () => navigate("/login");

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#fff", fontFamily: "'Inter', -apple-system, sans-serif", overflowX: "hidden" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 60px", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "rgba(10,10,10,0.9)", backdropFilter: "blur(12px)", zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#f5c542", fontSize: 20 }}>◆</span>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.3px" }}>STEMS <span style={{ color: "#f5c542" }}>AI</span></span>
        </div>
        <div style={{ display: "flex", gap: 40, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
          <a href="#how" style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}>How it Works</a>
          <a href="#agents" style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}>Agents</a>
          <a href="#pricing" style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}>Pricing</a>
        </div>
        <button onClick={goToDashboard} style={{ background: "#f5c542", color: "#0a0a0a", border: "none", borderRadius: 8, padding: "10px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          Get Started →
        </button>
      </nav>

      {/* HERO */}
      <section style={{ textAlign: "center", padding: "100px 20px 80px", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "inline-block", background: "rgba(245,197,66,0.1)", border: "1px solid rgba(245,197,66,0.3)", borderRadius: 20, padding: "6px 16px", fontSize: 12, color: "#f5c542", fontWeight: 600, letterSpacing: 1, marginBottom: 28, textTransform: "uppercase" }}>
          AI-Powered Sales Automation
        </div>
        <h1 style={{ fontSize: "clamp(38px, 6vw, 68px)", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-1.5px", margin: "0 0 24px" }}>
          Your AI Sales Team,<br />
          <span style={{ color: "#f5c542" }}>Working 24/7</span>
        </h1>
        <p style={{ fontSize: 18, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, maxWidth: 560, margin: "0 auto 44px" }}>
          Upload your leads. Our AI agents handle WhatsApp, Email, and Calls — automatically qualifying and converting while you sleep.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={goToDashboard} style={{ background: "#f5c542", color: "#0a0a0a", border: "none", borderRadius: 10, padding: "14px 32px", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
            Get Started Free →
          </button>
          <a href="#how" style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "14px 32px", fontWeight: 600, fontSize: 16, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            See How It Works
          </a>
        </div>
        <p style={{ marginTop: 20, fontSize: 13, color: "rgba(255,255,255,0.3)" }}>No credit card required · Setup in 2 minutes</p>
      </section>

      {/* STATS */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "40px 60px" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 80, flexWrap: "wrap" }}>
          {[["3x", "More Qualified Leads"], ["60%", "Lower Cost Per Lead"], ["24/7", "AI Follow-ups"], ["< 5min", "Setup Time"]].map(([num, label]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: "#f5c542", letterSpacing: "-1px" }}>{num}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding: "100px 60px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 12, color: "#f5c542", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.8px", margin: 0 }}>Three steps to more sales</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            { num: "01", icon: "📋", title: "Upload Your Leads", desc: "Drop your Excel sheet with names, emails, and phone numbers. Stems reads it instantly." },
            { num: "02", icon: "🤖", title: "AI Agents Activate", desc: "Our three agents — WhatsApp, Email, and Call — begin outreach simultaneously, personalised for each lead." },
            { num: "03", icon: "🔥", title: "Hot Leads Delivered", desc: "Only qualified, interested leads reach your sales team. You close — AI does the rest." },
          ].map(({ num, icon, title, desc }) => (
            <div key={num} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 32, position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 72, fontWeight: 900, color: "rgba(255,255,255,0.04)", position: "absolute", top: 16, right: 24, lineHeight: 1, fontFamily: "monospace" }}>{num}</div>
              <div style={{ fontSize: 40, marginBottom: 20 }}>{icon}</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px", letterSpacing: "-0.3px" }}>{title}</h3>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AGENTS */}
      <section id="agents" style={{ padding: "80px 60px", background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#f5c542", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>AGENTS</div>
        </div>
        <div style={{ maxWidth: 1100, margin: "40px auto 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {[
            { icon: "💬", color: "#22c55e", name: "WhatsApp Agent", tag: "Instant Outreach", features: ["Sends personalised opening messages", "AI replies to every response 24/7", "Qualifies leads via conversation", "Handles 1000s simultaneously"] },
            { icon: "📧", color: "#3b82f6", name: "Email Agent", tag: "Professional Follow-up", features: ["Writes personalised cold emails", "Automated Day 3 & Day 7 follow-ups", "AI replies to inbound responses", "Premium HTML email design"] },
            { icon: "📞", color: "#f59e0b", name: "Call Agent", tag: "Voice Conversion", features: ["AI voice calls in Hinglish", "Natural conversation, not robotic", "Handles objections intelligently", "Call recording & transcript saved"] },
          ].map(({ icon, color, name, tag, features }) => (
            <div key={name} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, background: `${color}18`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{name}</div>
                  <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 2 }}>{tag}</div>
                </div>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {features.map(f => (
                  <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                    <span style={{ color, marginTop: 1, flexShrink: 0 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: "100px 60px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 12, color: "#f5c542", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>PRICING</div>
          <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.8px", margin: "0 0 12px" }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.45)", margin: 0 }}>Start free. Scale when you grow.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {[
            { name: "Starter", price: "₹0", period: "/month", desc: "Perfect to get started", features: ["100 leads/month", "WhatsApp Agent", "Email Agent", "Basic CRM"], cta: "Start Free", highlight: false },
            { name: "Pro", price: "₹4,999", period: "/month", desc: "For growing businesses", features: ["5,000 leads/month", "All 3 Agents", "Advanced CRM", "AI Call Agent", "Priority Support"], cta: "Get Started", highlight: true },
            { name: "Enterprise", price: "Custom", period: "", desc: "For large sales teams", features: ["Unlimited leads", "Custom integrations", "Dedicated account manager", "White-label option", "SLA guarantee"], cta: "Contact Us", highlight: false },
          ].map(({ name, price, period, desc, features, cta, highlight }) => (
            <div key={name} style={{ background: highlight ? "linear-gradient(135deg, #f5c54210, #f5c54205)" : "rgba(255,255,255,0.03)", border: highlight ? "1px solid rgba(245,197,66,0.4)" : "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 32, position: "relative" }}>
              {highlight && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#f5c542", color: "#0a0a0a", fontSize: 11, fontWeight: 700, padding: "4px 14px", borderRadius: 20, letterSpacing: 0.5 }}>MOST POPULAR</div>}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>{name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 42, fontWeight: 800, color: highlight ? "#f5c542" : "#fff", letterSpacing: "-1px" }}>{price}</span>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>{period}</span>
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{desc}</div>
              </div>
              <ul style={{ listStyle: "none", margin: "0 0 28px", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {features.map(f => (
                  <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "rgba(255,255,255,0.65)" }}>
                    <span style={{ color: highlight ? "#f5c542" : "#22c55e" }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button onClick={goToDashboard} style={{ width: "100%", background: highlight ? "#f5c542" : "transparent", color: highlight ? "#0a0a0a" : "#fff", border: highlight ? "none" : "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "12px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                {cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA BANNER */}
      <section style={{ padding: "80px 60px", textAlign: "center", background: "linear-gradient(135deg, rgba(245,197,66,0.08) 0%, rgba(245,197,66,0.02) 100%)", borderTop: "1px solid rgba(245,197,66,0.15)" }}>
        <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.8px", margin: "0 0 16px" }}>Ready to 3x your leads?</h2>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", margin: "0 0 36px" }}>Join businesses already using Stems AI to automate their sales pipeline.</p>
        <button onClick={goToDashboard} style={{ background: "#f5c542", color: "#0a0a0a", border: "none", borderRadius: 12, padding: "16px 40px", fontWeight: 800, fontSize: 17, cursor: "pointer" }}>
          Open Dashboard →
        </button>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "32px 60px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#f5c542" }}>◆</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>STEMS <span style={{ color: "#f5c542" }}>AI</span></span>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", margin: 0 }}>© 2025 Stems Sales Agency · All rights reserved</p>
        <div style={{ display: "flex", gap: 24, fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          <span style={{ cursor: "pointer" }}>Privacy</span>
          <span style={{ cursor: "pointer" }}>Terms</span>
          <span style={{ cursor: "pointer" }}>Contact</span>
        </div>
      </footer>

    </div>
  );
}
