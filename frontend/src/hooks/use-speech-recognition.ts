import { useCallback, useEffect, useRef, useState } from "react";

// SpeechRecognition is not included in every browser's DOM typings.
export interface RecognitionResultEvent {
  results: ArrayLike<{ readonly [index: number]: { transcript: string } }>;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const browser = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

const errorMessages: Record<string, string> = {
  "not-allowed":
    "Microphone permission was denied. Allow microphone access in your browser, or type your answer.",
  "service-not-allowed":
    "Speech recognition is blocked by your browser. You can type your answer instead.",
  "audio-capture": "No microphone is available. Check your microphone or type your answer.",
  "language-not-supported":
    "Speech recognition does not support the selected language. You can type your answer instead.",
  "no-speech": "No speech was detected. Try the microphone again or type your answer.",
  network: "Speech recognition could not connect. Try again or type your answer.",
};

export function useSpeechRecognition(
  enabled: boolean,
  sessionKey: string,
  onTranscript: (text: string) => void,
  language: "English" | "Russian" = "English",
) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<BrowserSpeechRecognition | null>(null);
  const stopping = useRef(false);

  const cancel = useCallback(() => {
    const recognition = current.current;
    current.current = null;
    stopping.current = false;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // The browser may already have ended recognition.
      }
    }
    setListening(false);
  }, []);

  useEffect(() => {
    setSupported(!!recognitionConstructor());
  }, []);

  useEffect(() => {
    cancel();
    setError(null);
    return cancel;
  }, [enabled, sessionKey, language, cancel]);

  const start = (draft: string) => {
    const Recognition = recognitionConstructor();
    if (!enabled || !Recognition || current.current) return;
    setError(null);
    try {
      const recognition = new Recognition();
      recognition.lang = language === "Russian" ? "ru-RU" : "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        if (current.current !== recognition) return;
        // Results contain the whole recognition session. Rebuild them so revised
        // interim words replace earlier guesses instead of duplicating them.
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        onTranscript([draft.trimEnd(), transcript].filter(Boolean).join(" "));
      };
      recognition.onerror = (event) => {
        if (current.current !== recognition) return;
        if (event.error !== "aborted") {
          setError(
            errorMessages[event.error] ??
              "Speech recognition failed. Try again or type your answer.",
          );
        }
        cancel();
      };
      recognition.onend = () => {
        if (current.current !== recognition) return;
        current.current = null;
        stopping.current = false;
        setListening(false);
      };
      current.current = recognition;
      stopping.current = false;
      setListening(true);
      recognition.start();
    } catch {
      cancel();
      setError("Could not start the microphone. Check browser permissions or type your answer.");
    }
  };

  const stop = () => {
    if (!current.current || stopping.current) return;
    stopping.current = true;
    try {
      // Unlike abort(), stop() lets the browser deliver its final transcript.
      current.current.stop();
    } catch {
      cancel();
      setError("Could not stop speech recognition. You can still edit and send your answer.");
    }
  };

  return { supported, listening, error, start, stop, cancel };
}
