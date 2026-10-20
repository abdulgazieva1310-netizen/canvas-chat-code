import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCameraPreview } from "@/hooks/use-camera-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function cameraStream() {
  const track = new EventTarget() as EventTarget & { stop: ReturnType<typeof vi.fn> };
  track.stop = vi.fn();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function installCamera(getUserMedia?: MediaDevices["getUserMedia"]) {
  vi.stubGlobal("navigator", getUserMedia ? { mediaDevices: { getUserMedia } } : {});
}

it("requests camera permission only after opt-in and releases the track on stop and unmount", async () => {
  const { stream, track } = cameraStream();
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  installCamera(getUserMedia);
  const { result, unmount } = renderHook(() => useCameraPreview());
  expect(getUserMedia).not.toHaveBeenCalled();

  await act(async () => result.current.start());
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: true });
  expect(result.current.stream).toBe(stream);
  act(() => result.current.stop());
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.stream).toBeNull();

  const second = cameraStream();
  getUserMedia.mockResolvedValueOnce(second.stream);
  await act(async () => result.current.start());
  unmount();
  expect(second.track.stop).toHaveBeenCalledOnce();
});

it("reports denied permission and missing devices without preventing text or voice fallback", async () => {
  for (const [error, message] of [
    [new DOMException("Denied", "NotAllowedError"), "permission was denied"],
    [new DOMException("Missing", "NotFoundError"), "No camera was found"],
  ] as const) {
    installCamera(vi.fn().mockRejectedValue(error));
    const { result, unmount } = renderHook(() => useCameraPreview());
    await act(async () => result.current.start());
    expect(result.current.error).toContain(message);
    expect(result.current.stream).toBeNull();
    unmount();
  }
});

it("explains when browser camera access is unavailable", async () => {
  installCamera();
  const { result } = renderHook(() => useCameraPreview());
  await act(async () => result.current.start());
  expect(result.current.error).toContain("unavailable in this browser");
  expect(result.current.stream).toBeNull();
});

it("clears the preview and explains when the camera device is lost", async () => {
  const { stream, track } = cameraStream();
  installCamera(vi.fn().mockResolvedValue(stream));
  const { result } = renderHook(() => useCameraPreview());
  await act(async () => result.current.start());
  expect(result.current.stream).toBe(stream);

  act(() => track.dispatchEvent(new Event("ended")));

  expect(result.current.stream).toBeNull();
  expect(result.current.error).toContain("camera disconnected");
  expect(track.stop).toHaveBeenCalledOnce();
});

it("stops a stream that resolves after the user cancels the permission request", async () => {
  let resolve!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((done) => (resolve = done)));
  installCamera(getUserMedia);
  const { result } = renderHook(() => useCameraPreview());
  let starting!: Promise<void>;
  act(() => {
    starting = result.current.start();
  });
  act(() => {
    void result.current.start();
  });
  expect(getUserMedia).toHaveBeenCalledOnce();
  act(() => result.current.stop());
  const { stream, track } = cameraStream();
  await act(async () => {
    resolve(stream);
    await starting;
  });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.stream).toBeNull();
  expect(result.current.pending).toBe(false);
});
