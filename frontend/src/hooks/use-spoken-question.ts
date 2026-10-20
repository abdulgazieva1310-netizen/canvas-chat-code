import { useCallback, useEffect, useRef, useState } from "react";

function synthesis() {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : undefined;
}

export function useSpokenQuestion(
  enabled: boolean,
  questionId: string,
  text: string,
  language: "English" | "Russian" = "English",
  preferredVoiceName: string | null = null,
  preferredVoiceLang: string | null = null,
) {
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
      const voices = speaker.getVoices?.() ?? [];
      const voicePrefix = language === "Russian" ? "ru-" : "en-";
      const preferredVoice = preferredVoiceName && preferredVoiceLang
        ? { name: preferredVoiceName, lang: preferredVoiceLang }
        : null;
      const languageVoices = voices.filter((voice) =>
        voice.lang.toLowerCase().replaceAll("_", "-").startsWith(voicePrefix),
      );
      const voice = preferredVoice && preferredVoice.lang.toLowerCase().replaceAll("_", "-").startsWith(voicePrefix)
        ? languageVoices.find((item) => item.name === preferredVoice.name && item.lang === preferredVoice.lang)
        : undefined;
      const fallbackVoice = voice ?? languageVoices[0];
      if (preferredVoice && !voice) {
        setError(fallbackVoice
          ? `Your selected voice is unavailable for this session. Using ${fallbackVoice.name} instead.`
          : "Your selected voice is unavailable on this device. Using the browser default voice.");
      }
      if (
        language === "Russian" &&
        !fallbackVoice
      ) {
        setError(
          preferredVoice
            ? "The selected voice and a Russian system voice are unavailable. Read the transcript and continue by text."
            : "Spoken Russian is unavailable in this browser. Read the transcript and continue by text.",
        );
        return;
      }
      const next = new SpeechSynthesisUtterance(text);
      next.lang = language === "Russian" ? "ru-RU" : "en-US";
      if (fallbackVoice) next.voice = fallbackVoice;
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
  }, [language, preferredVoiceLang, preferredVoiceName, stop, text]);

  useEffect(() => {
    if (!enabled) {
      stop();
      lastQuestion.current = "";
      return;
    }
    const playbackKey = `${language}:${questionId}`;
    if (!questionId || !text || lastQuestion.current === playbackKey) return;
    lastQuestion.current = playbackKey;
    if (!muted && supported) replay();
    else stop();
    return stop;
  }, [enabled, questionId, text, language, muted, replay, stop, supported]);

  useEffect(() => stop, [stop]);

  const toggleMute = () => {
    setMuted((value) => {
      if (!value) stop();
      return !value;
    });
  };
  return { supported, muted, speaking, error, replay, stop, toggleMute };
}
