/**
 * Centralized API client using axios.
 *
 * Auth strategy (post-Supabase migration):
 * - Supabase manages all session state (login, refresh, logout, OTP).
 * - On every request, we call supabase.auth.getSession() to get the current
 *   access_token and attach it as a Bearer token to the FastAPI backend.
 * - Token refresh is handled automatically by the Supabase client (autoRefreshToken).
 * - No manual refresh interceptor or localStorage token management needed.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from "axios";
import { supabase } from "@/lib/supabase";

// In the browser, use a relative base URL so requests go through the
// Next.js dev-server rewrite proxy (/api/* → http://localhost:8000/api/*).
// This eliminates CORS preflight issues entirely.
// On the server side (SSR), we need the absolute URL.
const BASE_URL =
  typeof window === "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    : ""; // relative — proxied by next.config.mjs rewrites

// ── Axios instance ─────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// ── Request interceptor: attach Supabase access token ─────────────────────

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token && config.headers) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch {
      // Session unavailable — request proceeds without auth header
      // The backend will return 401 if the endpoint requires auth
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: handle 401 ──────────────────────────────────────

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // If 401, Supabase's autoRefreshToken will handle it on the next request.
    // If the session is truly expired, redirect to login.
    if (error.response?.status === 401) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session && typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ── Typed API helpers ──────────────────────────────────────────────────────

export interface ApiError {
  detail: string | Array<Record<string, unknown>>;
}

export function isApiError(error: unknown): error is AxiosError<ApiError> {
  return axios.isAxiosError(error) && error.response?.data?.detail !== undefined;
}

export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    const detail = error.response!.data.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const msg = detail[0]?.msg;
      return typeof msg === "string" ? msg : "Validation error";
    }
    return "An error occurred";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}
