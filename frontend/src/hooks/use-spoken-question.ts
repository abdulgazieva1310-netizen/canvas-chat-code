import { useCallback, useEffect, useRef, useState } from "react";

function synthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : undefined;
}

export function useSpokenQuestion(enabled: boolean, questionId: string, text: string) {
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastQuestion = useRef("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const supported = !!synthesis() && typeof SpeechSynthesisUtterance !== "undefined";

  const stop = useCallback(() => {
    synthesis()?.cancel();
    utterance.current = null;
    setSpeaking(false);
  }, []);

  const replay = useCallback(() => {
    stop();
    setError(null);
    const speaker = synthesis();
    if (!speaker || typeof SpeechSynthesisUtterance === "undefined") {
      setError(
        "Spoken questions are unavailable in this browser. Read the transcript and continue by text.",
      );
      return;
    }
    try {
      const next = new SpeechSynthesisUtterance(text);
      next.lang = "en-US";
      next.onstart = () => setSpeaking(true);
      next.onend = () => setSpeaking(false);
      next.onerror = () => {
        setSpeaking(false);
        setError("Question playback failed. Read the transcript and continue by text.");
      };
      utterance.current = next;
      speaker.speak(next);
    } catch {
      setError("Question playback failed. Read the transcript and continue by text.");
    }
  }, [stop, text]);

  useEffect(() => {
    if (!enabled) {
      stop();
      lastQuestion.current = "";
      return;
    }
    if (!questionId || !text || lastQuestion.current === questionId) return;
    lastQuestion.current = questionId;
    if (!muted && supported) replay();
    else stop();
    return stop;
  }, [enabled, questionId, text, muted, replay, stop, supported]);

  useEffect(() => stop, [stop]);

  const toggleMute = () => {
    setMuted((value) => {
      if (!value) stop();
      return !value;
    });
  };
  return { supported, muted, speaking, error, replay, stop, toggleMute };
}
