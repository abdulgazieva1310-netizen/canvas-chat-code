import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSpokenQuestion } from "@/hooks/use-spoken-question";

class FakeUtterance {
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("speaks a Russian question with the Russian voice locale", () => {
  const speak = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    getVoices: () => [{ lang: "ru-RU" }],
  });
  renderHook(() => useSpokenQuestion(true, "question-1", "Расскажите о проекте?", "Russian"));
  expect(speak).toHaveBeenCalledOnce();
  expect((speak.mock.calls[0]![0] as FakeUtterance).lang).toBe("ru-RU");
});

it("does not silently use an English voice for Russian playback", () => {
  const speak = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    getVoices: () => [{ lang: "en-US" }],
  });
  const { result } = renderHook(() => useSpokenQuestion(true, "question-1", "Вопрос?", "Russian"));
  expect(speak).not.toHaveBeenCalled();
  expect(result.current.error).toContain("Spoken Russian is unavailable");
});

it("uses Russian even when the saved preferred voice is English", () => {
  const speak = vi.fn();
  const russian = { name: "Russian system voice", lang: "ru_RU" };
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    getVoices: () => [{ name: "English preference", lang: "en-US" }, russian],
  });
  renderHook(() =>
    useSpokenQuestion(
      true,
      "question",
      "Расскажите о проекте?",
      "Russian",
      "English preference",
      "en-US",
    ),
  );
  expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0]![0].voice).toBe(russian);
  expect(speak.mock.calls[0]![0].lang).toBe("ru-RU");
});

it("allows explicit replay after Russian voices finish loading without using English fallback", () => {
  const speak = vi.fn();
  let voices: { name: string; lang: string }[] = [];
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), getVoices: () => voices });
  const { result } = renderHook(() => useSpokenQuestion(true, "question", "Вопрос?", "Russian"));
  expect(speak).not.toHaveBeenCalled();
  voices = [{ name: "Russian voice", lang: "ru-RU" }];
  act(() => result.current.replay());
  expect(result.current.error).toBeNull();
  expect(speak.mock.calls[0]![0].voice).toBe(voices[0]);
  expect(speak.mock.calls[0]![0].lang).toBe("ru-RU");
});

it("selects the matching voice and changes playback when session language changes", () => {
  const speak = vi.fn();
  const russian = { lang: "ru-RU", name: "Russian voice" };
  const english = { lang: "en-US", name: "English voice" };
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), getVoices: () => [english, russian] });
  const { rerender } = renderHook(
    ({ language }: { language: "English" | "Russian" }) =>
      useSpokenQuestion(true, "same-question", "Текст вопроса", language),
    { initialProps: { language: "Russian" as "English" | "Russian" } },
  );
  expect(speak.mock.calls[0]![0].voice).toBe(russian);
  rerender({ language: "English" });
  expect(speak).toHaveBeenCalledTimes(2);
  expect(speak.mock.calls[1]![0].voice).toBe(english);
});

it("uses a compatible system voice and explains when the saved voice is unavailable", () => {
  const speak = vi.fn();
  const available = { lang: "en-US", name: "Available system voice" };
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), getVoices: () => [available] });
  const { result } = renderHook(() =>
    useSpokenQuestion(
      true,
      "question-1",
      "Tell me about your work.",
      "English",
      "Missing voice",
      "en-GB",
    ),
  );
  expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0]![0].voice).toBe(available);
  expect(result.current.error).toContain("Using Available system voice instead");
});
