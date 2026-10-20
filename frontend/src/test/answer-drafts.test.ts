import { afterEach, expect, it, vi } from "vitest";
import {
  clearAllAnswerDrafts,
  clearInterviewAnswerDrafts,
  loadAnswerDraft,
  saveAnswerDraft,
} from "@/lib/answer-drafts";
import { saveAuthorization } from "@/lib/api/session";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("scopes Unicode and coding-language drafts to their owner, interview, and question", () => {
  expect(saveAnswerDraft("owner-a", "interview-a", "question-a", "ответ Ω", "python")).toBe(
    "saved",
  );
  expect(loadAnswerDraft("owner-a", "interview-a", "question-a").draft).toMatchObject({
    text: "ответ Ω",
    codingLanguage: "python",
  });
  expect(loadAnswerDraft("owner-b", "interview-a", "question-a").draft).toBeNull();
  expect(loadAnswerDraft("owner-a", "interview-a", "question-b").draft).toBeNull();
});

it("expires stale drafts and clears interview drafts by owner", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  saveAnswerDraft("owner-a", "interview-a", "question-a", "old answer", null);
  saveAnswerDraft("owner-b", "interview-a", "question-a", "other owner", null);
  saveAnswerDraft("owner-a", "interview-b", "question-a", "other interview", null);

  clearInterviewAnswerDrafts("interview-a", "owner-a");
  expect(loadAnswerDraft("owner-a", "interview-a", "question-a").draft).toBeNull();
  expect(loadAnswerDraft("owner-b", "interview-a", "question-a").draft?.text).toBe("other owner");

  vi.setSystemTime(new Date("2026-10-21T00:00:01Z"));
  expect(loadAnswerDraft("owner-b", "interview-a", "question-a").draft).toBeNull();
});

it("clears drafts on logout and account deletion auth cleanup", () => {
  saveAnswerDraft("owner-a", "interview-a", "question-a", "answer", null);
  saveAuthorization(null);
  expect(loadAnswerDraft("owner-a", "interview-a", "question-a").draft).toBeNull();
});

it("reports oversize and quota failures without throwing", () => {
  expect(saveAnswerDraft("owner-a", "interview-a", "question-a", "x".repeat(65 * 1024), null)).toBe(
    "too-large",
  );

  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  expect(saveAnswerDraft("owner-a", "interview-a", "question-a", "answer", null)).toBe(
    "unavailable",
  );
});

it("reports when session storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  expect(loadAnswerDraft("owner-a", "interview-a", "question-a").available).toBe(false);
  clearAllAnswerDrafts();
});
