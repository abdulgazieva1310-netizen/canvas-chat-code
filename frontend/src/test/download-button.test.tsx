import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { DownloadButton } from "@/components/DownloadButton";
import { saveDownload } from "@/lib/download";
vi.mock("@/lib/download", () => ({ saveDownload: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps the download retryable after failure and disables pending requests", async () => {
  let finish!: (blob: Blob) => void;
  const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => new Promise<Blob>(resolve => { finish = resolve; }));
  render(<QueryClientProvider client={new QueryClient()}><DownloadButton label="Download Markdown report" filename="report.md" load={load} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("button", {name:"Downloading…"})).toBeDisabled();
  const blob = new Blob(["# Saved report"]);
  finish(blob);
  await screen.findByRole("button", {name:"Download Markdown report"});
  expect(saveDownload).toHaveBeenCalledWith(blob,"report.md");
});
