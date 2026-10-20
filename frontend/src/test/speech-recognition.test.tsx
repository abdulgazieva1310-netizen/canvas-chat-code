import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useSpeechRecognition,
  type BrowserSpeechRecognition,
} from "@/hooks/use-speech-recognition";

class FakeRecognition implements BrowserSpeechRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: BrowserSpeechRecognition["onresult"] = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onend: BrowserSpeechRecognition["onend"] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  result(...parts: string[]) {
    this.onresult?.({ results: parts.map((transcript) => [{ transcript }]) });
  }
}

function install(prefixed = false) {
  vi.stubGlobal("SpeechRecognition", prefixed ? undefined : FakeRecognition);
  vi.stubGlobal("webkitSpeechRecognition", prefixed ? FakeRecognition : undefined);
}

function latest() {
  return FakeRecognition.instances.at(-1)!;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeRecognition.instances = [];
});

it.each([false, true])(
  "transcribes with standard or prefixed recognition (prefixed=%s)",
  (prefixed) => {
    install(prefixed);
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(true, "session", onTranscript));
    expect(result.current.supported).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(0); // Never requests permission automatically.
    act(() => result.current.start("My draft"));
    expect(latest().start).toHaveBeenCalledOnce();
    expect(latest().lang).toBe("en-US");
    expect(latest().continuous).toBe(true);
    expect(latest().interimResults).toBe(true);
    expect(result.current.listening).toBe(true);
    act(() => latest().result("I use a hash"));
    expect(onTranscript).toHaveBeenLastCalledWith("My draft I use a hash");
    act(() => latest().result("I use a hash map", "to find duplicates"));
    expect(onTranscript).toHaveBeenLastCalledWith("My draft I use a hash map to find duplicates");
    act(() => result.current.stop());
    expect(latest().stop).toHaveBeenCalledOnce();
    act(() => latest().result("I use a hash map", "to find duplicate values."));
    expect(onTranscript).toHaveBeenLastCalledWith(
      "My draft I use a hash map to find duplicate values.",
    );
    act(() => latest().onend?.());
    expect(result.current.listening).toBe(false);
  },
);

it("sets the browser recognition locale for a Russian interview", () => {
  install();
  const { result } = renderHook(() => useSpeechRecognition(true, "session", vi.fn(), "Russian"));
  act(() => result.current.start(""));
  expect(latest().lang).toBe("ru-RU");
});

it("keeps typing available when the API is unsupported", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  const { result } = renderHook(() => useSpeechRecognition(true, "session", vi.fn()));
  expect(result.current.supported).toBe(false);
  act(() => result.current.start("Typed draft"));
  expect(result.current.listening).toBe(false);
});

it.each([
  ["not-allowed", "permission was denied"],
  ["audio-capture", "No microphone is available"],
  ["no-speech", "No speech was detected"],
  ["network", "could not connect"],
])("handles %s without losing the transcript", (error, message) => {
  install();
  const onTranscript = vi.fn();
  const { result } = renderHook(() => useSpeechRecognition(true, "session", onTranscript));
  act(() => result.current.start(""));
  act(() => latest().result("Already spoken words"));
  act(() => latest().onerror?.({ error }));
  expect(result.current.error).toContain(message);
  expect(result.current.listening).toBe(false);
  expect(onTranscript).toHaveBeenLastCalledWith("Already spoken words");
  expect(latest().abort).toHaveBeenCalledOnce();
  act(() => result.current.start("Already spoken words"));
  expect(result.current.error).toBeNull();
  expect(FakeRecognition.instances).toHaveLength(2);
});

it("aborts and ignores late results after cancellation or unmount", () => {
  install();
  const onTranscript = vi.fn();
  const { result, unmount } = renderHook(() => useSpeechRecognition(true, "session", onTranscript));
  act(() => result.current.start(""));
  const first = latest();
  const lateResult = first.onresult!;
  act(() => result.current.cancel());
  expect(first.abort).toHaveBeenCalledOnce();
  act(() => lateResult({ results: [[{ transcript: "late words" }]] }));
  expect(onTranscript).not.toHaveBeenCalled();
  act(() => result.current.start(""));
  const second = latest();
  unmount();
  expect(second.abort).toHaveBeenCalledOnce();
  expect(second.onresult).toBeNull();
});

it("stops when controls become disabled or the interview changes", () => {
  install();
  const { result, rerender } = renderHook(
    ({ enabled, id, language }) => useSpeechRecognition(enabled, id, vi.fn(), language),
    { initialProps: { enabled: true, id: "first", language: "English" as const } },
  );
  act(() => result.current.start(""));
  const first = latest();
  rerender({ enabled: false, id: "first", language: "English" });
  expect(first.abort).toHaveBeenCalledOnce();
  expect(result.current.listening).toBe(false);
  act(() => result.current.start(""));
  expect(FakeRecognition.instances).toHaveLength(1);
  rerender({ enabled: true, id: "second", language: "Russian" });
  act(() => result.current.start(""));
  const second = latest();
  expect(second.lang).toBe("ru-RU");
  rerender({ enabled: true, id: "third", language: "Russian" });
  expect(second.abort).toHaveBeenCalledOnce();
});

it("handles startup errors and prevents duplicate starts", () => {
  install();
  const { result } = renderHook(() => useSpeechRecognition(true, "session", vi.fn()));
  act(() => result.current.start(""));
  act(() => result.current.start(""));
  expect(FakeRecognition.instances).toHaveLength(1);
  act(() => result.current.cancel());
  class BrokenRecognition extends FakeRecognition {
    override start = vi.fn(() => {
      throw new Error("Permission failure");
    });
  }
  vi.stubGlobal("SpeechRecognition", BrokenRecognition);
  act(() => result.current.start(""));
  expect(result.current.error).toContain("Could not start the microphone");
  expect(result.current.listening).toBe(false);
});
