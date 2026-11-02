import { expect, request, test } from "@playwright/test";
import { apiUrl, endInterview, registerAccount, removeAccount, startInterview } from "./helpers";

test("recording requires consent, is private and playable, and can be revoked or deleted", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const browser = window as any;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }),
      },
    });
    class TestRecorder extends EventTarget {
      static isTypeSupported(type: string) {
        return type === "audio/webm";
      }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, _options?: unknown) {
        super();
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["deterministic audio fixture"], { type: this.mimeType }) });
        this.onstop?.();
        this.dispatchEvent(new Event("stop"));
      }
    }
    browser.MediaRecorder = TestRecorder;
  });

  const account = await registerAccount(page, "media-recording");
  try {
    const revokeId = await startInterview(page);
    const recordingConsent = page.getByLabel(
      "I consent to storing my recording for up to 30 days for private playback.",
    );
    const startRecording = page.getByRole("button", { name: "Start recording" });
    await expect(startRecording).toBeDisabled();
    await recordingConsent.check();
    await expect(startRecording).toBeEnabled();
    const grant = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${revokeId}/media/consent` &&
        response.request().method() === "POST",
    );
    await startRecording.click();
    expect((await grant).status()).toBe(204);
    await expect(page.getByText("Recording on this device.")).toBeVisible();
    const stopAndSave = page.getByRole("button", { name: "Stop and save recording" });
    const revokedUploadPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${revokeId}/media` &&
        response.request().method() === "POST",
    );
    await stopAndSave.click();
    const revokedUpload = await revokedUploadPromise;
    expect(revokedUpload.status()).toBe(201);
    const revokedMedia = await revokedUpload.json();
    expect(revokedMedia).toMatchObject({ mediaType: "audio/webm" });
    expect(revokedMedia.sizeBytes).toBeGreaterThan(0);
    expect(revokedMedia).not.toHaveProperty("data");
    expect(revokedMedia).not.toHaveProperty("content");

    const revoke = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${revokeId}/media/consent` &&
        response.request().method() === "POST",
    );
    await recordingConsent.uncheck();
    expect((await revoke).status()).toBe(204);
    const afterRevocation = await page.request.get(apiUrl(`/interviews/${revokeId}/media`), {
      headers: { Authorization: account.authorization },
    });
    expect((await afterRevocation.json()).media).toEqual([]);
    const rejectedUpload = await page.request.post(apiUrl(`/interviews/${revokeId}/media`), {
      headers: { Authorization: account.authorization, "Content-Type": "audio/webm" },
      data: "upload without consent",
    });
    expect(rejectedUpload.status()).toBe(409);
    await endInterview(page, revokeId);

    const playbackId = await startInterview(page);
    const playbackConsent = page.getByLabel(
      "I consent to storing my recording for up to 30 days for private playback.",
    );
    const consentResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${playbackId}/media/consent` &&
        response.request().method() === "POST",
    );
    await playbackConsent.check();
    const beginRecording = page.getByRole("button", { name: "Start recording" });
    await beginRecording.click();
    expect((await consentResponse).status()).toBe(204);
    const uploadResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${playbackId}/media` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Stop and save recording" }).click();
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(201);
    const media = (await uploaded.json()) as { id: string; mediaType: string; sizeBytes: number };
    expect(media.mediaType).toBe("audio/webm");
    expect(media.sizeBytes).toBeGreaterThan(0);

    const list = await page.request.get(apiUrl(`/interviews/${playbackId}/media`), {
      headers: { Authorization: account.authorization },
    });
    expect(list.status()).toBe(200);
    expect(await list.json()).toMatchObject({ retentionDays: 30, media: [{ id: media.id }] });

    const secondApi = await request.newContext();
    const otherEmail = `other-${Date.now()}@example.com`;
    try {
      const anonymousList = await secondApi.get(apiUrl(`/interviews/${playbackId}/media`));
      expect(anonymousList.status()).toBe(401);
      const anonymousPlayback = await secondApi.get(
        apiUrl(`/interviews/${playbackId}/media/${media.id}`),
      );
      expect(anonymousPlayback.status()).toBe(401);
      const anonymousDelete = await secondApi.delete(
        apiUrl(`/interviews/${playbackId}/media/${media.id}`),
      );
      expect(anonymousDelete.status()).toBe(401);

      const otherRegistration = await secondApi.post(apiUrl("/auth/register"), {
        data: { email: otherEmail, name: "Other E2E User", password: "Other-E2E-2026!" },
      });
      expect(otherRegistration.status()).toBe(201);
      const otherAuthorization = otherRegistration.headers()["authorization"];
      const hidden = await secondApi.get(apiUrl(`/interviews/${playbackId}/media`), {
        headers: { Authorization: otherAuthorization },
      });
      expect(hidden.status()).toBe(404);
      const hiddenPlayback = await secondApi.get(
        apiUrl(`/interviews/${playbackId}/media/${media.id}`),
        { headers: { Authorization: otherAuthorization } },
      );
      expect(hiddenPlayback.status()).toBe(404);
      const hiddenDelete = await secondApi.delete(
        apiUrl(`/interviews/${playbackId}/media/${media.id}`),
        { headers: { Authorization: otherAuthorization } },
      );
      expect(hiddenDelete.status()).toBe(404);
      const cleanup = await secondApi.delete(apiUrl("/auth/me"), {
        headers: { Authorization: otherAuthorization },
        data: { password: "Other-E2E-2026!", confirmation: "DELETE" },
      });
      expect(cleanup.status()).toBe(204);
    } finally {
      await secondApi.dispose();
    }

    await endInterview(page, playbackId);
    const playResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${playbackId}/media/${media.id}` &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Play recording" }).click();
    const playback = await playResponse;
    expect(playback.status()).toBe(200);
    expect(playback.headers()["content-type"]).toContain("audio/webm");
    await expect(page.locator("audio")).toBeVisible();

    const deletion = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/interviews/${playbackId}/media/${media.id}` &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Delete recording" }).click();
    expect((await deletion).status()).toBe(204);
    await expect(page.getByText("No saved recordings.")).toBeVisible();
    const gone = await page.request.get(
      apiUrl(`/interviews/${playbackId}/media/${media.id}`),
      { headers: { Authorization: account.authorization } },
    );
    expect(gone.status()).toBe(404);
  } finally {
    await removeAccount(page, account);
  }
});
