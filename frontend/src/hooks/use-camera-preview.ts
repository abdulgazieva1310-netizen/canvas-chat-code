import { useCallback, useEffect, useRef, useState } from "react";

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. You can continue with text or voice.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. You can continue with text or voice.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera could not start. Check that it is connected and available, or continue with text or voice.";
  }
  return "The camera could not be started. You can continue with text or voice.";
}

export function useCameraPreview() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  const stop = useCallback(() => {
    requestRef.current += 1;
    pendingRef.current = false;
    const current = streamRef.current;
    streamRef.current = null;
    stopTracks(current);
    setStream(null);
    setPending(false);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current || pendingRef.current) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera access is unavailable in this browser. You can continue with text or voice.",
      );
      return;
    }

    const requestId = ++requestRef.current;
    pendingRef.current = true;
    setPending(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      if (!mountedRef.current || requestRef.current !== requestId) {
        stopTracks(next);
        return;
      }
      streamRef.current = next;
      const trackEnded = () => {
        if (
          !mountedRef.current ||
          requestRef.current !== requestId ||
          streamRef.current !== next
        ) {
          return;
        }
        streamRef.current = null;
        stopTracks(next);
        setStream(null);
        setError("The camera disconnected. Reconnect it or continue with text or voice.");
      };
      next.getTracks().forEach((track) => track.addEventListener("ended", trackEnded, { once: true }));
      setStream(next);
    } catch (reason) {
      if (mountedRef.current && requestRef.current === requestId) setError(cameraError(reason));
    } finally {
      if (mountedRef.current && requestRef.current === requestId) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      pendingRef.current = false;
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return { stream, pending, error, start, stop };
}
