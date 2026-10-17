import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockApi, defaultSetup } from "@/lib/api/mock-api";

async function response<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(500);
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("MockApi", () => {
  it("waits 500 ms and returns users without exposing passwords", async () => {
    const login = MockApi.login("test@example.com", "secret");
    const settled = vi.fn();
    void login.then(settled);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await login).toMatchObject({ email: "test@example.com" });
    const user = await response(
      MockApi.register({ name: "Test", email: "test@example.com", password: "secret" }),
    );
    expect(user.name).toBe("Test");
    expect(user).not.toHaveProperty("password");
    expect(JSON.stringify(sessionStorage)).not.toContain("secret");
  });

  it("preserves settings, answers, hints, partial reports and history", async () => {
    const setup = {
      ...defaultSetup,
      role: "Backend Developer" as const,
      questionCount: 5 as const,
      jobDescription: "Build APIs",
    };
    const interview = await response(MockApi.startInterview(setup));
    expect(interview.setup).toEqual(setup);
    expect(interview.messages).toHaveLength(1);
    const hinted = await response(MockApi.getHint(interview.id));
    expect(hinted.messages.at(-1)?.from).toBe("hint");
    const answered = await response(
      MockApi.sendMessage(interview.id, "I would profile the service."),
    );
    expect(answered.answeredCount).toBe(1);
    expect(answered.lastFeedback).not.toBeNull();
    // Mutating a returned object must not change stored backend state.
    answered.messages.length = 0;
    expect((await response(MockApi.getInterview(interview.id))).messages.length).toBeGreaterThan(0);
    expect(await response(MockApi.getHistory())).toEqual([]);
    await response(MockApi.endInterview(interview.id));
    const report = await response(MockApi.getReport(interview.id));
    expect(report.interview.status).toBe("incomplete");
    expect(report.feedback.questions[0]?.answer).toBe("I would profile the service.");
    expect((await response(MockApi.getHistory()))[0]?.id).toBe(interview.id);
  });

  it("completes at the question limit and withholds live assistance in Real Interview mode", async () => {
    const interview = await response(
      MockApi.startInterview({ ...defaultSetup, mode: "Real Interview", questionCount: 5 }),
    );
    const hintError = expect(MockApi.getHint(interview.id)).rejects.toThrow("Practice");
    await vi.advanceTimersByTimeAsync(500);
    await hintError;
    for (let i = 0; i < 5; i++) {
      const updated = await response(MockApi.sendMessage(interview.id, `Answer ${i + 1}`));
      expect(updated.lastFeedback).toBeNull();
      expect(updated.status).toBe(i === 4 ? "complete" : "active");
    }
    const report = await response(MockApi.getReport(interview.id));
    expect(report.feedback.questions).toHaveLength(5);
    expect(report.feedback.scores).not.toBeNull();
    expect((await response(MockApi.endInterview(interview.id))).status).toBe("complete");
    const sendError = expect(MockApi.sendMessage(interview.id, "Too late")).rejects.toThrow(
      "ended",
    );
    await vi.advanceTimersByTimeAsync(500);
    await sendError;
  });

  it("reports an unanswered early ending without invented scores", async () => {
    const interview = await response(MockApi.startInterview(defaultSetup));
    await response(MockApi.endInterview(interview.id));
    const { feedback } = await response(MockApi.getReport(interview.id));
    expect(feedback.overall).toBeNull();
    expect(feedback.questions).toEqual([]);
  });

  it("rejects missing interviews and active reports", async () => {
    const missing = expect(MockApi.getInterview("missing")).rejects.toThrow("not found");
    await vi.advanceTimersByTimeAsync(500);
    await missing;
    const interview = await response(MockApi.startInterview(defaultSetup));
    const active = expect(MockApi.getReport(interview.id)).rejects.toThrow("End the interview");
    await vi.advanceTimersByTimeAsync(500);
    await active;
  });
});
