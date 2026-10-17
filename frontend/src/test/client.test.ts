import { afterEach, expect, it, vi } from "vitest";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";

afterEach(() => vi.unstubAllGlobals());

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
  await Api.sendMessage("a/b", "Answer");
  await Api.getHint("a/b");
  await Api.endInterview("a/b");
  await Api.getReport("a/b");
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
  ]);
  for (const [, options] of fetch.mock.calls) expect(options.credentials).toBe("include");
  expect(fetch.mock.calls[0]?.[1].body).toBe(
    JSON.stringify({ email: "demo@example.com", password: "demo-password" }),
  );
  expect(fetch.mock.calls[2]?.[1].body).toBe(JSON.stringify(defaultSetup));
  expect(fetch.mock.calls[5]?.[1].body).toBe(JSON.stringify({ text: "Answer" }));
  expect(fetch.mock.calls[6]?.[1]).not.toHaveProperty("body");
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
