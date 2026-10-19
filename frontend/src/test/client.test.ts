import { afterEach, expect, it, vi } from "vitest";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it("reuses a start key after a lost response and uses a new key after success", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockImplementation(
      async () => new Response(JSON.stringify({ id: "created", setup: defaultSetup })),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(Api.startInterview(defaultSetup)).rejects.toThrow("response lost");
  await Api.startInterview(defaultSetup);
  await Api.startInterview(defaultSetup);
  const keys = fetch.mock.calls.map(([, options]) => options.headers["Idempotency-Key"]);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

it("restores an unresolved start key from browser session storage", async () => {
  const fingerprint = JSON.stringify([null, defaultSetup]);
  sessionStorage.setItem(
    "interview-mirror.pending-starts",
    JSON.stringify([[fingerprint, "before-reload"]]),
  );
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: "restored", setup: defaultSetup })));
  vi.stubGlobal("fetch", fetch);
  await Api.startInterview(defaultSetup);
  expect(fetch.mock.calls[0]?.[1].headers["Idempotency-Key"]).toBe("before-reload");
  expect(
    JSON.parse(sessionStorage.getItem("interview-mirror.pending-starts") || "[]"),
  ).not.toContainEqual([fingerprint, "before-reload"]);
});

it("preserves credentials when requesting recovery and clears them after replacement", async () => {
  sessionStorage.setItem("interview-mirror.authorization", "Bearer existing");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"message":"Accepted"}', { status: 202 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await Api.requestPasswordReset("person@example.com");
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBe("Bearer existing");
  await Api.resetPassword("reset-token", "replacement");
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBeNull();
  for (const [, options] of fetch.mock.calls) {
    expect(options.headers).not.toHaveProperty("Authorization");
  }
});

it("uses backend endpoints with cookies and JSON bodies", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "session-123", setup: defaultSetup }))),
    );
  vi.stubGlobal("fetch", fetch);
  await Api.login("demo@example.com", "demo-password");
  await Api.register({ name: "Test", email: "a@b.com", password: "secret" });
  await Api.startInterview(defaultSetup);
  await Api.getHistory();
  await Api.getInterview("a/b");
  await Api.sendMessage("a/b", "Answer", undefined, "question-1");
  await Api.getHint("a/b");
  await Api.endInterview("a/b");
  await Api.getReport("a/b");
  await Api.resumeInterview("a/b");
  expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    ["http://localhost:8000/api/auth/login", "POST"],
    ["http://localhost:8000/api/auth/register", "POST"],
    ["http://localhost:8000/api/interviews", "POST"],
    ["http://localhost:8000/api/interviews", "GET"],
    ["http://localhost:8000/api/interviews/a%2Fb", "GET"],
    ["http://localhost:8000/api/interviews/a%2Fb/messages", "POST"],
    ["http://localhost:8000/api/interviews/a%2Fb/hint", "POST"],
    ["http://localhost:8000/api/interviews/a%2Fb/end", "POST"],
    ["http://localhost:8000/api/interviews/a%2Fb/report", "GET"],
    ["http://localhost:8000/api/interviews/a%2Fb/resume", "POST"],
  ]);
  for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe("include");
  expect(fetch.mock.calls[0]?.[1].body).toBe(
    JSON.stringify({ email: "demo@example.com", password: "demo-password" }),
  );
  expect(fetch.mock.calls[2]?.[1].body).toBe(JSON.stringify(defaultSetup));
  expect(fetch.mock.calls[5]?.[1].body).toBe(
    JSON.stringify({ text: "Answer", expectedQuestionId: "question-1" }),
  );
  expect(fetch.mock.calls[6]?.[1]).not.toHaveProperty("body");
  expect(fetch.mock.calls[9]?.[1]).not.toHaveProperty("body");
});

it("encodes every history filter and pagination parameter in stable order", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, page: 2, pageSize: 20 })));
  vi.stubGlobal("fetch", fetch);
  await Api.getHistoryPage({
    role: "C++ Developer",
    type: "Role-specific",
    startDate: "2026-10-01",
    endDate: "2026-10-19",
    minScore: 7.5,
    maxScore: 9,
    search: "API & databases",
    page: 2,
    pageSize: 20,
  });
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost:8000/api/interviews?role=C%2B%2B+Developer&type=Role-specific&startDate=2026-10-01&endDate=2026-10-19&minScore=7.5&maxScore=9&search=API+%26+databases&page=2&pageSize=20",
    expect.objectContaining({ method: "GET", credentials: "include" }),
  );
});

it("preserves backend errors and signals expired sessions", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Sign in required" }), { status: 401 }),
      ),
  );
  const expired = vi.fn();
  window.addEventListener("api:unauthorized", expired, { once: true });
  await expect(Api.getHistory()).rejects.toMatchObject({
    status: 401,
    message: "Sign in required",
  });
  expect(expired).toHaveBeenCalledOnce();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
  await expect(Api.getHistory()).rejects.toMatchObject({
    status: 502,
    message: "Request failed (502).",
  });
});

it.each([
  null,
  {},
  { id: "" },
  { id: "   " },
  { interviewId: "session-123" },
  { id: "session-123" },
])("rejects invalid start responses: %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  await expect(Api.startInterview(defaultSetup)).rejects.toThrow(
    "did not return a valid interview",
  );
});

it("clears expired authorization after a 401", async () => {
  sessionStorage.setItem("interview-mirror.authorization", "Bearer expired");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () => new Response('{"message":"Authentication required."}', { status: 401 }),
      ),
  );
  await expect(Api.getHistory()).rejects.toMatchObject({ status: 401 });
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBeNull();
});

it("keeps cookie authentication when no bearer response header is available", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await Api.login("demo@example.com", "secret");
  await Api.getHistory();
  expect(sessionStorage.getItem("interview-mirror.authorization")).toBeNull();
  expect(fetch.mock.calls[1]?.[1].credentials).toBe("include");
  expect(fetch.mock.calls[1]?.[1].headers).not.toHaveProperty("Authorization");
  expect(JSON.stringify(sessionStorage)).not.toContain("secret");
});

it("deletes the encoded interview ID and accepts an empty 204 response", async () => {
  const response = new Response(null, { status: 204 });
  const json = vi.spyOn(response, "json");
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  await expect(Api.deleteInterview("a/b")).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith(
    "http://localhost:8000/api/interviews/a%2Fb",
    expect.objectContaining({
      method: "DELETE",
      credentials: "include",
    }),
  );
  expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
  expect(json).not.toHaveBeenCalled();
});

it("preserves deletion errors for the dashboard", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Interview not found." }), { status: 404 }),
      ),
  );
  await expect(Api.deleteInterview("missing")).rejects.toMatchObject({
    status: 404,
    message: "Interview not found.",
  });
});

it("loads and updates the authenticated profile and logs out with credentials", async () => {
  const profile = {
    id: "user",
    name: "Aigerim",
    email: "a@example.com",
    targetRole: "Python Developer",
    level: "Senior",
    preferredLanguage: "English",
  };
  const values = {
    name: "Aigerim",
    targetRole: "Python Developer" as const,
    level: "Senior" as const,
  };
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: string, options: RequestInit) =>
      options.method === "POST"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(profile)),
    );
  sessionStorage.setItem("interview-mirror.authorization", "Bearer token");
  vi.stubGlobal("fetch", fetch);
  expect(await Api.getProfile()).toEqual(profile);
  expect(await Api.updateProfile(values)).toEqual(profile);
  await Api.logout();
  expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    ["http://localhost:8000/api/auth/me", "GET"],
    ["http://localhost:8000/api/auth/me", "PATCH"],
    ["http://localhost:8000/api/auth/logout", "POST"],
  ]);
  expect(fetch.mock.calls[1]?.[1].body).toBe(JSON.stringify(values));
  for (const [, options] of fetch.mock.calls) {
    expect(options.credentials).toBe("include");
    expect(options.headers.Authorization).toBe("Bearer token");
  }
});

it("includes the selected coding language in message requests", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "session-123" })));
  vi.stubGlobal("fetch", fetch);
  await Api.sendMessage("session-123", "const answer = 42;", "JavaScript", "question-1");
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
    text: "const answer = 42;",
    selectedLanguage: "JavaScript",
    expectedQuestionId: "question-1",
  });
});
