import axios from "axios";

const normalizeBaseUrl = (url) => (url || "").replace(/\/+$/, "");

// The one backend this app talks to: the EC2 box behind stemsai.in, which
// runs both the FastAPI backend and the WhatsApp agent.
const primaryBackend = "https://stemsai.in";

// A build-time environment variable is a *development* override only. Pinning
// production here keeps the deployed origin in version control instead of in a
// dashboard setting, where a stale value silently pointed the live site at a
// decommissioned host.
const devBackends = () => [
  normalizeBaseUrl(
    process.env.REACT_APP_BACKEND_URL ||
    process.env.VITE_BACKEND_URL ||
    process.env.VITE_API_URL
  ),
  primaryBackend,
];
const backendCandidates = (
  process.env.NODE_ENV === "production" ? [primaryBackend] : devBackends()
)
  .filter(Boolean)
  .filter((url, index, arr) => arr.indexOf(url) === index);

// The backend can be slow on a cold start; a short timeout turns that into a
// bogus "login failed".
const REQUEST_TIMEOUT_MS = 60000;

// Single source of truth for the backend origin — every direct fetch /
// EventSource in the app must use this so the SPA never splits its calls
// across two different backends.
export const backendBaseUrl = backendCandidates[0];

const api = axios.create({
  baseURL: `${backendCandidates[0]}/api`,
  timeout: REQUEST_TIMEOUT_MS,
});

// Wake a sleeping backend early (e.g. while the user is in the Google popup)
// so the request that actually matters does not eat the cold start.
export const warmUpBackend = () =>
  Promise.all(
    backendCandidates.map((url) =>
      fetch(`${url}/api/health`, { method: "GET", mode: "cors" }).catch(() => null)
    )
  );

// Pull the useful part out of an axios failure. The backend puts an
// actionable message in `detail`; dropping it leaves the user staring at a
// generic "something failed" with no way to tell config from outage.
export const describeApiError = (e, fallback = "Something went wrong") => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (e?.code === "ECONNABORTED") {
    return "The server took too long to respond (it may have been asleep). Please try again.";
  }
  if (!e?.response) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return e?.message || fallback;
};

api.interceptors.request.use((config) => {
  const sessionId = localStorage.getItem("session_id");
  if (sessionId) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${sessionId}`;
  }
  if (typeof config.__backendIndex !== "number") {
    config.__backendIndex = 0;
  }
  if (!config.baseURL) {
    config.baseURL = `${backendCandidates[config.__backendIndex]}/api`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const cfg = error?.config;
    if (!cfg) return Promise.reject(error);

    const networkFailure = !error.response;
    const retryableStatus = [502, 503, 504].includes(error?.response?.status);
    if (!networkFailure && !retryableStatus) {
      return Promise.reject(error);
    }

    const nextIndex = (cfg.__backendIndex ?? 0) + 1;
    if (nextIndex >= backendCandidates.length) {
      return Promise.reject(error);
    }

    cfg.__backendIndex = nextIndex;
    cfg.baseURL = `${backendCandidates[nextIndex]}/api`;
    return api.request(cfg);
  }
);

export default api;
