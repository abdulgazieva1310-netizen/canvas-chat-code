import { getAuthorization, saveAuthorization } from "./session";
import type {
  Interview,
  DashboardSummary,
  InterviewReport,
  InterviewSetup,
  HistoryPage,
  HistoryQuery,
  ProfileUpdate,
  RegisterData,
  User,
} from "./types";

const baseUrl = (import.meta.env["VITE_API_BASE_URL"] || "http://localhost:8000/api").replace(
  /\/+$/,
  "",
);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  { notifyUnauthorized = true }: { notifyUnauthorized?: boolean } = {},
): Promise<T> {
  const isAuthRequest =
    path === "/auth/login" || path === "/auth/register" || path.startsWith("/auth/password-reset/");
  const authorization = isAuthRequest ? null : getAuthorization();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status === 401 && !isAuthRequest) saveAuthorization(null);
    if (
      !isAuthRequest &&
      notifyUnauthorized &&
      response.status === 401 &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event("api:unauthorized"));
    }
    throw new ApiError(
      response.status,
      typeof error?.message === "string" ? error.message : `Request failed (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T;
  if (path === "/auth/login" || path === "/auth/register") {
    const authorization = response.headers.get("Authorization");
    saveAuthorization(authorization?.startsWith("Bearer ") ? authorization : null);
  }
  return data;
}

const interviewPath = (id: string) => `/interviews/${encodeURIComponent(id)}`;

export const Api = {
  getDashboardSummary: () => request<DashboardSummary>("/dashboard/summary"),
  getProfile: () => request<User>("/auth/me"),
  updateProfile: (data: ProfileUpdate) => request<User>("/auth/me", data, "PATCH"),
  logout: () => request<void>("/auth/logout", undefined, "POST"),
  login: (email: string, password: string) => request<User>("/auth/login", { email, password }),
  register: (data: RegisterData) => request<User>("/auth/register", data),
  requestPasswordReset: (email: string) =>
    request<{ message: string }>("/auth/password-reset/request", { email }),
  async resetPassword(token: string, password: string) {
    await request<void>("/auth/password-reset/confirm", { token, password });
    saveAuthorization(null);
  },
  async startInterview(setup: InterviewSetup): Promise<Interview> {
    const interview = await request<Interview>("/interviews", setup, "POST", {
      notifyUnauthorized: false,
    });
    if (typeof interview?.id !== "string" || !interview.id.trim() || !interview.setup) {
      throw new Error("The backend did not return a valid interview. Please try starting again.");
    }
    return interview;
  },
  getInterview: (id: string) => request<Interview>(interviewPath(id)),
  deleteInterview: (id: string) => request<void>(interviewPath(id), undefined, "DELETE"),
  resumeInterview: (id: string) =>
    request<Interview>(`${interviewPath(id)}/resume`, undefined, "POST"),
  sendMessage: (id: string, text: string, selectedLanguage?: string, expectedQuestionId?: string) =>
    request<Interview>(`${interviewPath(id)}/messages`, {
      text,
      ...(selectedLanguage ? { selectedLanguage } : {}),
      ...(expectedQuestionId ? { expectedQuestionId } : {}),
    }),
  getHint: (id: string) => request<Interview>(`${interviewPath(id)}/hint`, undefined, "POST"),
  endInterview: (id: string) => request<Interview>(`${interviewPath(id)}/end`, undefined, "POST"),
  getReport: (id: string) => request<InterviewReport>(`${interviewPath(id)}/report`),
  getHistoryPage: (query: HistoryQuery) => {
    const params = new URLSearchParams();
    for (const key of ["role", "type", "startDate", "endDate", "minScore", "maxScore", "search", "page", "pageSize"] as const) {
      const value = query[key];
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const encoded = params.toString();
    const suffix = encoded ? `?${encoded}` : "";
    return request<HistoryPage>(`/interviews${suffix}`);
  },
  getHistory: () => request<Interview[]>("/interviews"),
};
