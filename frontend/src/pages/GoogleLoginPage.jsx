import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import api, { warmUpBackend } from "../lib/api";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "882008866919-n5pb2uatmt49a1rm83f9svu3jootu1vm.apps.googleusercontent.com";
const GSI_SRC = "https://accounts.google.com/gsi/client";

const describeLoginError = (e) => {
  if (e?.response?.data?.detail) return e.response.data.detail;
  if (e?.code === "ECONNABORTED") {
    return "The server took too long to respond (it may have been asleep). Please try again.";
  }
  if (!e?.response) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return e?.message || "Login failed";
};

export default function GoogleLoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const mounted = useRef(true);

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
      setError(describeLoginError(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const startLogin = () => {
    setError("");
    if (!window.google?.accounts?.id) {
      setError("Google SDK not loaded. Refresh page and try again.");
      return;
    }
    // One Tap is suppressed whenever third-party sign-in is restricted; when
    // that happens point the user at the rendered button instead of failing
    // silently.
    window.google.accounts.id.prompt((notification) => {
      const skipped = notification?.isSkippedMoment?.() || notification?.isNotDisplayed?.();
      if (skipped) {
        setError('Google One Tap was blocked by the browser. Use the "Continue with Google" button above.');
      }
    });
  };

  useEffect(() => {
    mounted.current = true;
    // Wake the backend now so the token exchange after sign-in is not the
    // request that pays for a cold start.
    warmUpBackend();

    const initGoogle = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => completeLogin(resp?.credential || ""),
        // Surfaces origin / client-id configuration problems instead of
        // leaving the user on a button that does nothing.
        error_callback: (err) => {
          setError(
            err?.type === "popup_closed"
              ? "Google sign-in was cancelled."
              : `Google sign-in failed (${err?.type || "unknown error"}). Make sure this site's URL is listed as an authorized JavaScript origin for the Google client.`
          );
        },
        use_fedcm_for_prompt: true,
        auto_select: false,
        cancel_on_tap_outside: true,
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
      return () => { mounted.current = false; };
    }

    // Reuse an existing tag if one is already loading; never remove it on
    // unmount, because a later mount would then find a half-loaded SDK.
    let s = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      document.body.appendChild(s);
    }
    const onLoad = () => initGoogle();
    const onError = () => setError("Failed to load Google SDK");
    s.addEventListener("load", onLoad);
    s.addEventListener("error", onError);
    return () => {
      mounted.current = false;
      s.removeEventListener("load", onLoad);
      s.removeEventListener("error", onError);
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
            {loading ? "Signing you in..." : sdkReady ? "Having trouble? Try Google popup again" : "Loading Google..."}
          </Button>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
