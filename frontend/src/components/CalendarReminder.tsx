import { useMemo, useState, type FormEvent } from "react";
import type { InterviewSetup } from "@/lib/api/types";
import {
  createCalendarReminder,
  defaultLocalDateTime,
  downloadCalendarReminder,
  localDateTimeToUtc,
  setupReminderUrl,
} from "@/lib/calendar-reminder";

const durationOptions = [15, 30, 45, 60] as const;

function availableTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const supported = intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set(["UTC", local, ...supported])].sort();
}

function validationMessage(reason: "invalid" | "nonexistent" | "ambiguous" | "past") {
  switch (reason) {
    case "invalid":
      return "Enter a valid date, time, and IANA time zone.";
    case "nonexistent":
      return "That local time does not exist because the clocks move forward. Choose another time.";
    case "ambiguous":
      return "That local time occurs twice when clocks move back. Choose an unambiguous time.";
    case "past":
      return "Choose a future date and time.";
  }
}

export function CalendarReminder({ setup }: { setup: InterviewSetup }) {
  const timeZones = useMemo(availableTimeZones, []);
  const [localDateTime, setLocalDateTime] = useState(() => defaultLocalDateTime());
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [duration, setDuration] = useState<(typeof durationOptions)[number]>(30);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const createReminder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    const result = localDateTimeToUtc(localDateTime, timeZone);
    if (!result.ok) {
      setStatus({ kind: "error", message: validationMessage(result.reason) });
      return;
    }
    const setupUrl = setupReminderUrl(window.location.origin, {
      role: setup.role,
      interviewType: setup.type,
      level: setup.level,
      language: setup.language,
    });
    const content = createCalendarReminder(result.date, duration, setupUrl);
    if (!downloadCalendarReminder(content, result.date)) {
      setStatus({ kind: "error", message: "The calendar file could not be downloaded. Please try again." });
      return;
    }
    setStatus({ kind: "success", message: "Calendar reminder downloaded. Import it to add the event." });
  };

  return (
    <section className="card-surface mt-6 space-y-4 p-5" aria-labelledby="calendar-reminder-title">
      <div>
        <h2 id="calendar-reminder-title" className="text-xl">Plan a practice reminder</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download a calendar event. It opens Setup after sign-in and never starts an interview automatically.
        </p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={createReminder}>
        <label className="grid gap-1 text-sm" htmlFor="reminder-date-time">
          Local date and time
          <input
            id="reminder-date-time"
            type="datetime-local"
            required
            value={localDateTime}
            onChange={(event) => setLocalDateTime(event.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="reminder-time-zone">
          Time zone
          <select
            id="reminder-time-zone"
            required
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            className="rounded border bg-background p-2"
          >
            {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor="reminder-duration">
          Duration
          <select
            id="reminder-duration"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value) as (typeof durationOptions)[number])}
            className="rounded border bg-background p-2"
          >
            {durationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary self-end">
          Download calendar reminder
        </button>
      </form>
      {status && (
        <p role={status.kind === "error" ? "alert" : "status"} aria-live="polite" className="text-sm">
          {status.message}
        </p>
      )}
    </section>
  );
}
