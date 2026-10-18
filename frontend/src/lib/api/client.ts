import { getAuthorization, saveAuthorization } from "./session";
import type { Interview, InterviewReport, InterviewSetup, RegisterData, User } from "./types";

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
  const isAuthRequest = path === "/auth/login" || path === "/auth/register";
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
  const data = (await response.json()) as T;
  if (isAuthRequest) {
    const authorization = response.headers.get("Authorization");
    saveAuthorization(authorization?.startsWith("Bearer ") ? authorization : null);
  }
  return data;
}

const interviewPath = (id: string) => `/interviews/${encodeURIComponent(id)}`;

export const Api = {
  login: (email: string, password: string) => request<User>("/auth/login", { email, password }),
  register: (data: RegisterData) => request<User>("/auth/register", data),
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
  resumeInterview: (id: string) => request<Interview>(`${interviewPath(id)}/resume`, undefined, "POST"),
  sendMessage: (id: string, text: string) =>
    request<Interview>(`${interviewPath(id)}/messages`, { text }),
  getHint: (id: string) => request<Interview>(`${interviewPath(id)}/hint`, undefined, "POST"),
  endInterview: (id: string) => request<Interview>(`${interviewPath(id)}/end`, undefined, "POST"),
  getReport: (id: string) => request<InterviewReport>(`${interviewPath(id)}/report`),
  getHistory: () => request<Interview[]>("/interviews"),
};
