import axios from "axios";

const normalizeBaseUrl = (url) => (url || "").replace(/\/+$/, "");

const configuredBackend = normalizeBaseUrl(process.env.REACT_APP_BACKEND_URL);
const backendCandidates = [configuredBackend, "http://localhost:8001", "http://localhost:8000"]
  .filter(Boolean)
  .filter((url, index, arr) => arr.indexOf(url) === index);

const api = axios.create({
  baseURL: `${backendCandidates[0]}/api`,
  timeout: 15000,
});

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
