import axios from "axios";

const normalizeBaseUrl = (url) => (url || "").replace(/\/+$/, "");

const configuredBackend = normalizeBaseUrl(
  process.env.REACT_APP_BACKEND_URL ||
  process.env.VITE_BACKEND_URL ||
  process.env.VITE_API_URL
);
// The one backend this app talks to — the service defined in render.yaml.
const primaryBackend = "https://stems-sales-agent-backend.onrender.com";
const backendCandidates = [configuredBackend, primaryBackend]
  .filter(Boolean)
  .filter((url, index, arr) => arr.indexOf(url) === index);

// Render's free plan spins services down after idling, and a cold start can
// take well over 30s. A short timeout turns that into a bogus "login failed".
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
