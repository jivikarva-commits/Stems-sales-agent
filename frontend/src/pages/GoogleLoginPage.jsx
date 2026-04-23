import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import api from "../lib/api";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "882008866919-n5pb2uatmt49a1rm83f9svu3jootu1vm.apps.googleusercontent.com";

export default function GoogleLoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  
  const completeLogin = async (credential) => {
    if (!credential) {
      setError("Google credential not found. Please click Continue with Google.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/google", { credential });
      const user = res.data || {};
      if (!user.session_id) throw new Error("Session not created");
      localStorage.setItem("session_id", user.session_id);
      localStorage.setItem("user_email", user.email || "");
      localStorage.setItem("user_name", user.name || "");
      localStorage.setItem("user_picture", user.picture || "");
      localStorage.setItem("onboarding_completed", user.onboarding_completed ? "true" : "false");
      window.location.hash = "";
      navigate(user.onboarding_completed ? "/dashboard" : "/agent-setup", { replace: true });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const startLogin = () => {
    setError("");
    if (!window.google?.accounts?.id) {
      setError("Google SDK not loaded. Refresh page and try again.");
      return;
    }
    window.google.accounts.id.prompt();
  };

  useEffect(() => {
    const initGoogle = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => completeLogin(resp?.credential || ""),
      });
      const host = document.getElementById("google-signin-btn");
      if (host) {
        host.innerHTML = "";
        window.google.accounts.id.renderButton(host, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 320,
        });
      }
      setSdkReady(true);
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => initGoogle();
    s.onerror = () => setError("Failed to load Google SDK");
    document.body.appendChild(s);
    return () => {
      if (document.body.contains(s)) {
        document.body.removeChild(s);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-800 p-6">
        <h1 className="text-2xl font-bold mb-2">Google Login</h1>
        <p className="text-sm text-slate-400 mb-6">Sign in to open your personal Sales Agent workspace.</p>
        <div className="space-y-3">
          <div id="google-signin-btn" className="flex justify-center" />
          <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={startLogin} disabled={loading || !sdkReady}>
            {sdkReady ? "Having trouble? Try Google popup again" : "Loading Google..."}
          </Button>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
