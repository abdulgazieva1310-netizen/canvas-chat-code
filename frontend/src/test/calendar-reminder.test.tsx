import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarReminder } from "@/components/CalendarReminder";
import { defaultSetup } from "@/lib/api/default-setup";
import {
  createCalendarReminder,
  escapeCalendarText,
  localDateTimeToUtc,
  setupReminderUrl,
} from "@/lib/calendar-reminder";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fixedNow = new Date("2026-01-01T00:00:00Z");

it("converts explicit time zones and rejects invalid, missing, and repeated local times", () => {
  expect(localDateTimeToUtc("2026-03-08T02:30", "America/New_York", fixedNow)).toEqual({
    ok: false,
    reason: "nonexistent",
  });
  expect(localDateTimeToUtc("2026-11-01T01:30", "America/New_York", fixedNow)).toEqual({
    ok: false,
    reason: "ambiguous",
  });
  expect(localDateTimeToUtc("2026-02-30T10:00", "UTC", fixedNow)).toEqual({
    ok: false,
    reason: "invalid",
  });
  expect(localDateTimeToUtc("2026-03-08T03:30", "America/New_York", fixedNow)).toEqual({
    ok: true,
    date: new Date("2026-03-08T07:30:00Z"),
  });
});

it("escapes calendar text and creates a bounded UTC event with a generic Setup link", () => {
  expect(escapeCalendarText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  const setupUrl = setupReminderUrl("https://practice.example", {
    role: "QA Engineer",
    interviewType: "Behavioral",
    level: "Junior",
    language: "English",
  });
  const parsed = new URL(setupUrl);
  expect([...parsed.searchParams.keys()].sort()).toEqual(["interviewType", "language", "level", "role"]);
  expect(setupUrl).not.toMatch(/token|transcript|score|email|secret/i);

  const event = createCalendarReminder(
    new Date("2026-03-08T07:30:00Z"),
    45,
    setupUrl,
    "attempt-123@interview-mirror",
    fixedNow,
  );
  expect(event).toContain("UID:attempt-123@interview-mirror\r\n");
  expect(event).toContain("DTSTART:20260308T073000Z\r\n");
  expect(event).toContain("DTEND:20260308T081500Z\r\n");
  expect(event).toContain("SUMMARY:Interview practice reminder\r\n");
  const unfolded = event.replace(/\r\n /g, "");
  expect(unfolded).toContain(`URL:${setupUrl}\r\n`);
  expect(unfolded).not.toMatch(/transcript|score|email|job description/i);
  expect(unfolded).toContain("DESCRIPTION:Time set aside for interview practice.");
  expect(event.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
});

it("downloads a reminder from Setup and shows DST validation without starting an interview", async () => {
  const createObjectURL = vi.fn(() => "blob:calendar-reminder");
  const revokeObjectURL = vi.fn();
  class TestURL extends URL {}
  Object.assign(TestURL, { createObjectURL, revokeObjectURL });
  vi.stubGlobal("URL", TestURL);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<CalendarReminder setup={defaultSetup} />);

  fireEvent.change(screen.getByLabelText("Local date and time"), {
    target: { value: "2026-03-08T02:30" },
  });
  fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/New_York" } });
  fireEvent.click(screen.getByRole("button", { name: "Download calendar reminder" }));
  expect(screen.getByRole("alert")).toHaveTextContent("does not exist because the clocks move forward");
  expect(click).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Local date and time"), {
    target: { value: "2030-05-06T14:30" },
  });
  fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "60" } });
  createObjectURL.mockImplementationOnce(() => {
    throw new Error("Retry fixture");
  });
  fireEvent.click(screen.getByRole("button", { name: "Download calendar reminder" }));
  expect(screen.getByRole("alert")).toHaveTextContent("could not be downloaded");
  expect(screen.getByLabelText("Local date and time")).toHaveValue("2030-05-06T14:30");
  fireEvent.click(screen.getByRole("button", { name: "Download calendar reminder" }));
  expect(screen.getByRole("status")).toHaveTextContent("Calendar reminder downloaded");
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:calendar-reminder"));
  const link = createObjectURL.mock.calls[1]![0] as Blob;
  expect(link.type).toBe("text/calendar;charset=utf-8");
});
